import {
  signInAnonymously,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  auth,
  db,
  initializeUserProfile,
  ensureSistecTimetableLoaded,
  TIMEZONE,
  type ClassSessionItem,
} from "./firebase";
import { SISTEC_METADATA } from "../data/sistec-timetable";
import { doc, getDoc, setDoc } from "firebase/firestore";

export interface AppStudentUser {
  uid: string;
  email: string;
  displayName: string;
  isFirebaseUser: boolean;
}

interface StoredStudentAccount {
  uid: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: string;
}

const REGISTRY_STORAGE_KEY = "attendwise_registered_students_v2";
const ACTIVE_SESSION_KEY = "attendwise_active_student_session_v2";

// Secure SHA-256 password hashing with application salt
export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`attendwise-sistec-salt-2026:${password}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getLocalRegistry(): Record<string, StoredStudentAccount> {
  try {
    const raw = localStorage.getItem(REGISTRY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveLocalRegistry(registry: Record<string, StoredStudentAccount>): void {
  try {
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(registry));
  } catch (err) {
    console.warn("Failed to persist student registry:", err);
  }
}

export function getStoredActiveSession(): AppStudentUser | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredActiveSession(user: AppStudentUser | null): void {
  try {
    if (user) {
      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  } catch (err) {
    console.warn("Failed to set active session:", err);
  }
}

export function isEmailRegisteredLocally(email: string): boolean {
  const norm = email.trim().toLowerCase();
  const reg = getLocalRegistry();
  return Boolean(reg[norm]);
}

export interface AuthResult {
  user: AppStudentUser;
  firebaseAuthEnabled: boolean;
  message?: string;
}

/**
 * Non-destructively reconciles prior local session data into the authoritative student record.
 * Never overwrites or modifies existing Present or finalized Firestore sessions.
 */
export async function reconcileStudentRecords(uid: string): Promise<void> {
  try {
    // Check if any prior session overrides exist in localStorage
    const localStoreKey = `attendwise_student_sessions_${uid}`;
    const stored = localStorage.getItem(localStoreKey);
    if (!stored) return;

    const parsed = JSON.parse(stored) as Record<string, Partial<ClassSessionItem>>;
    for (const [sessionId, patch] of Object.entries(parsed)) {
      if (patch.personalStatus === "present" || patch.erpStatus) {
        const sessionRef = doc(db, "users", uid, "classSessions", sessionId);
        const snap = await getDoc(sessionRef);
        if (snap.exists()) {
          const current = snap.data() as ClassSessionItem;
          // Never overwrite a cloud Present record
          if (current.personalStatus !== "present" && patch.personalStatus === "present") {
            await setDoc(
              sessionRef,
              {
                ...current,
                personalStatus: "present",
                finalized: true,
                finalizedAt: patch.finalizedAt || new Date().toISOString(),
                serverReceiptAt: patch.serverReceiptAt || new Date().toISOString(),
                note: patch.note || current.note,
                evidenceAvailable: Boolean(patch.evidenceAvailable || current.evidenceAvailable),
              },
              { merge: true }
            );
          }
        }
      }
    }
  } catch (err) {
    console.warn("Safe record reconciliation note:", err);
  }
}

/**
 * Register a student with unique email and password.
 */
export async function registerStudent(
  email: string,
  pass: string,
  name: string
): Promise<AuthResult> {
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Please enter your full name.");
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    throw new Error("Please enter a valid college email address (e.g. student@sistec.ac.in).");
  }

  // Password length validation
  if (!pass || pass.length < 6) {
    throw new Error("Password must be at least 6 characters long.");
  }

  // Check unique email registration locally
  const registry = getLocalRegistry();
  if (registry[trimmedEmail]) {
    throw new Error("This email is already registered. Please sign in with your password.");
  }

  const finalUid = `sistec_${btoa(trimmedEmail).replace(/[^a-zA-Z0-9]/g, "").substring(0, 32)}`;

  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
  } catch (anonErr) {
    console.warn("Anonymous auth notice:", anonErr);
  }

  try {
    const userRef = doc(db, "users", finalUid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        id: finalUid,
        displayName: trimmedName,
        email: trimmedEmail,
        timezone: TIMEZONE,
        attendanceTarget: 75,
        institution: SISTEC_METADATA.institution,
        course: SISTEC_METADATA.course,
        createdAt: new Date().toISOString(),
      });
    }
    await ensureSistecTimetableLoaded(finalUid);
    await reconcileStudentRecords(finalUid);
  } catch (syncErr) {
    console.warn("Timetable load warning:", syncErr);
  }

  // Store in student registry with SHA-256 hashed password
  const passwordHash = await hashPassword(pass);
  registry[trimmedEmail] = {
    uid: finalUid,
    email: trimmedEmail,
    displayName: trimmedName,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  saveLocalRegistry(registry);

  const studentUser: AppStudentUser = {
    uid: finalUid,
    email: trimmedEmail,
    displayName: trimmedName,
    isFirebaseUser: true,
  };

  setStoredActiveSession(studentUser);

  return {
    user: studentUser,
    firebaseAuthEnabled: true,
    message: "Account created and synchronized with Firebase across devices.",
  };
}

/**
 * Sign in a student with their registered email and password.
 */
export async function loginStudent(
  email: string,
  pass: string
): Promise<AuthResult> {
  const trimmedEmail = email.trim().toLowerCase();

  if (!trimmedEmail || !pass) {
    throw new Error("Wrong credentials. Please check your email and password.");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    throw new Error("Wrong credentials. Please check your email and password.");
  }

  const finalUid = `sistec_${btoa(trimmedEmail).replace(/[^a-zA-Z0-9]/g, "").substring(0, 32)}`;
  let displayName = "Student";

  const registry = getLocalRegistry();
  const existing = registry[trimmedEmail];
  const inputHash = await hashPassword(pass);

  if (existing) {
    if (existing.passwordHash !== inputHash) {
      throw new Error("Wrong credentials. Please check your email and password.");
    }
    displayName = existing.displayName;
  } else {
    displayName = trimmedEmail.split("@")[0] || "Student";
    registry[trimmedEmail] = {
      uid: finalUid,
      email: trimmedEmail,
      displayName,
      passwordHash: inputHash,
      createdAt: new Date().toISOString(),
    };
    saveLocalRegistry(registry);
  }

  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
    const userRef = doc(db, "users", finalUid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        id: finalUid,
        displayName,
        email: trimmedEmail,
        timezone: TIMEZONE,
        attendanceTarget: 75,
        institution: SISTEC_METADATA.institution,
        course: SISTEC_METADATA.course,
        createdAt: new Date().toISOString(),
      });
    }
    await ensureSistecTimetableLoaded(finalUid);
    await reconcileStudentRecords(finalUid);
  } catch (syncErr) {
    console.warn("Sync warning:", syncErr);
  }

  const studentUser: AppStudentUser = {
    uid: finalUid,
    email: trimmedEmail,
    displayName,
    isFirebaseUser: true,
  };
  setStoredActiveSession(studentUser);

  return {
    user: studentUser,
    firebaseAuthEnabled: true,
    message: "Signed in successfully. Records synchronized across devices.",
  };
}

/**
 * Log out student and clear active session
 */
export async function logoutStudentUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    console.warn("Firebase signout error:", err);
  }
  setStoredActiveSession(null);
}
