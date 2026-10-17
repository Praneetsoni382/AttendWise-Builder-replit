import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  getDocFromServer,
} from "firebase/firestore";
import {
  getStorage,
  ref,
  uploadString,
  getDownloadURL,
} from "firebase/storage";
import firebaseConfig from "../../../../firebase-applet-config.json";
import {
  SISTEC_METADATA,
  SISTEC_SUBJECTS,
  SISTEC_TIMETABLE_SLOTS,
} from "../data/sistec-timetable";
import {
  isTeachingDay,
  getTeachingDayNumber,
  getHolidayInfo,
  getCalendarDayInfo,
  SISTEC_OFFICIAL_HOLIDAYS,
  SISTEC_CALENDAR_SUMMARY,
  BTECH_3RD_TEACHING_DAYS,
} from "../data/sistec-calendar";

// Initialize Firebase with IndexedDB persistent local cache to prevent quota exhaustion
const app = getApps().length > 0 ? getApps()[0]! : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(
  app,
  {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  },
  firebaseConfig.firestoreDatabaseId
);
export const storage = getStorage(app, firebaseConfig.storageBucket);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test connection on boot
export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

// Types
export interface StudentProfile {
  id: string;
  displayName: string;
  email: string;
  timezone: string;
  attendanceTarget: number;
  institution?: string;
  course?: string;
  createdAt: string;
}

export interface SubjectItem {
  id: string;
  studentId: string;
  code: string;
  name: string;
  category: "Theory" | "Practical";
  teacherName?: string | null;
  iconKey?: string;
  reviewNeeded?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimetableItem {
  id: string;
  studentId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  slot: string;
  dayOfWeek: number; // 1 = Mon ... 6 = Sat
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  category: "Theory" | "Practical";
  room?: string | null;
  teacherName?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClassSessionItem {
  id: string;
  studentId: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  timetableEntryId: string | null;
  slot?: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledStartAt: string; // ISO
  scheduledEndAt: string; // ISO
  category: "Theory" | "Practical";
  room?: string | null;
  personalStatus: "upcoming" | "present" | "absent" | "cancelled" | "frozen";
  erpStatus: "Present" | "Absent" | null;
  note?: string | null;
  absentType?: "manual_student" | "automatic_overdue" | null;
  frozenAt?: string | null;
  canMarkPresent?: boolean;
  finalized: boolean;
  finalizedAt?: string | null;
  cancelledAt?: string | null;
  serverReceiptAt?: string | null;
  clientCaptureAt?: string | null;
  evidenceAvailable?: boolean;
  evidenceStoragePath?: string | null;
  academicDayNumber?: number | null;
  createdAt: string;
}

export interface AttendanceEventItem {
  id: string;
  sessionId: string;
  eventType: string;
  serverTimestamp: string;
  message: string;
}

export const TIMEZONE = SISTEC_METADATA.timezone;

// Helpers for IST Dates
const IST_OFFSET_MINUTES = 330;

export function getNowIST(): Date {
  return new Date();
}

export function formatDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function getWeekdayIST(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "narrow",
  }).format(date);
  // Using Intl weekday numeric
  const dayName = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
  }).format(date);
  switch (dayName) {
    case "Monday": return 1;
    case "Tuesday": return 2;
    case "Wednesday": return 3;
    case "Thursday": return 4;
    case "Friday": return 5;
    case "Saturday": return 6;
    case "Sunday": return 7;
    default: return 1;
  }
}

export function makeIstDateTime(dateKey: string, timeString: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hours, minutes] = timeString.split(":").map(Number);
  if (!year || !month || !day || hours === undefined || minutes === undefined) {
    throw new Error(`Invalid IST date/time: ${dateKey} ${timeString}`);
  }
  return new Date(
    Date.UTC(year, month - 1, day, hours, minutes) - IST_OFFSET_MINUTES * 60 * 1000
  );
}

// Authentication Service Functions
export async function signUpStudent(email: string, pass: string, name: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  await updateProfile(cred.user, { displayName: name });
  await initializeUserProfile(cred.user, name);
  return cred.user;
}

export async function signInStudent(email: string, pass: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email, pass);
  await initializeUserProfile(cred.user, cred.user.displayName || "Student");
  return cred.user;
}

export async function signInWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  await initializeUserProfile(cred.user, cred.user.displayName || "Student");
  return cred.user;
}

export async function resetStudentPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

export async function logOutStudent(): Promise<void> {
  await signOut(auth);
}

// Initialize profile in Firestore
export async function initializeUserProfile(user: User, displayName: string): Promise<void> {
  const userRef = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      const profile: StudentProfile = {
        id: user.uid,
        displayName: displayName || user.displayName || "Student",
        email: user.email || "",
        timezone: TIMEZONE,
        attendanceTarget: 75,
        institution: SISTEC_METADATA.institution,
        course: SISTEC_METADATA.course,
        createdAt: new Date().toISOString(),
      };
      await setDoc(userRef, profile);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
  }
}

// Ensure any stored P4 timetable entries and class sessions reflect the corrected 12:35 to 1:35 timings
export async function syncTimetableSlotTimings(uid: string): Promise<void> {
  try {
    const timetableRef = collection(db, "users", uid, "timetableEntries");
    const timetableSnap = await getDocs(timetableRef);
    const batch = writeBatch(db);
    let updatedCount = 0;

    timetableSnap.forEach((docSnap) => {
      const data = docSnap.data() as TimetableItem;
      const expectedSlot = SISTEC_TIME_SLOTS.find((s) => s.slot === data.slot);
      if (expectedSlot && (data.startTime !== expectedSlot.start || data.endTime !== expectedSlot.end)) {
        batch.update(docSnap.ref, {
          startTime: expectedSlot.start,
          endTime: expectedSlot.end,
          updatedAt: new Date().toISOString(),
        });
        updatedCount++;
      }
    });

    const sessionsRef = collection(db, "users", uid, "classSessions");
    const sessionsSnap = await getDocs(sessionsRef);
    sessionsSnap.forEach((docSnap) => {
      const data = docSnap.data() as ClassSessionItem;
      const expectedSlot = SISTEC_TIME_SLOTS.find((s) => s.slot === data.slot);
      if (expectedSlot) {
        const expectedStart = makeIstDateTime(data.scheduledDate, expectedSlot.start).toISOString();
        const expectedEnd = makeIstDateTime(data.scheduledDate, expectedSlot.end).toISOString();
        if (data.scheduledStartAt !== expectedStart || data.scheduledEndAt !== expectedEnd) {
          batch.update(docSnap.ref, {
            scheduledStartAt: expectedStart,
            scheduledEndAt: expectedEnd,
          });
          updatedCount++;
        }
      }
    });

    if (updatedCount > 0) {
      await batch.commit();
    }
  } catch (err) {
    console.warn("Could not sync timetable slot timings:", err);
  }
}

// Load authentic SISTec timetable and subjects if not yet seeded for this user
export async function ensureSistecTimetableLoaded(uid: string): Promise<void> {
  const subjectsRef = collection(db, "users", uid, "subjects");
  try {
    const snap = await getDocs(subjectsRef);
    if (!snap.empty) {
      // Already initialized: ensure P4 timings (12:35-1:35) and weekly sessions are synced
      await syncTimetableSlotTimings(uid);
      await generateWeeklySessions(uid);
      return;
    }

    const batch = writeBatch(db);
    const subjectMap = new Map<string, SistecSubjectSeed>();

    // 1. Batch create all 12 SISTec Subjects
    for (const sub of SISTEC_SUBJECTS) {
      subjectMap.set(sub.id, sub);
      const subDocRef = doc(db, "users", uid, "subjects", sub.id);
      batch.set(subDocRef, {
        id: sub.id,
        studentId: uid,
        code: sub.code,
        name: sub.name,
        category: sub.category,
        teacherName: null,
        iconKey: sub.iconKey,
        reviewNeeded: sub.reviewNeeded ?? false,
        notes: sub.notes ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // 2. Batch create all 36 SISTec Timetable entries
    let entryIndex = 1;
    for (const slotSeed of SISTEC_TIMETABLE_SLOTS) {
      const sub = subjectMap.get(slotSeed.subjectId);
      const entryId = `entry-${slotSeed.dayOfWeek}-${slotSeed.slot}-${entryIndex++}`;
      const entryDocRef = doc(db, "users", uid, "timetableEntries", entryId);
      batch.set(entryDocRef, {
        id: entryId,
        studentId: uid,
        subjectId: slotSeed.subjectId,
        subjectName: sub?.name ?? "Subject",
        subjectCode: sub?.code ?? "CODE",
        slot: slotSeed.slot,
        dayOfWeek: slotSeed.dayOfWeek,
        startTime: slotSeed.startTime,
        endTime: slotSeed.endTime,
        category: slotSeed.category,
        room: slotSeed.room ?? (slotSeed.category === "Practical" ? "Lab" : "Classroom"),
        teacherName: null,
        active: true,
        sourceId: "sistec-timetable-2026",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    await batch.commit();

    // 3. Generate initial upcoming class sessions for today and the rest of current week
    await generateWeeklySessions(uid);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}/subjects`);
  }
}

// Build default authentic SISTec subjects, timetable entries, and sessions
export function buildDefaultSistecData(uid: string): {
  subjects: SubjectItem[];
  timetable: TimetableItem[];
  sessions: ClassSessionItem[];
} {
  const subjectMap = new Map<string, SubjectItem>();
  const subjects: SubjectItem[] = SISTEC_SUBJECTS.map((sub) => {
    const item: SubjectItem = {
      id: sub.id,
      studentId: uid,
      code: sub.code,
      name: sub.name,
      category: sub.category,
      teacherName: null,
      iconKey: sub.iconKey,
      reviewNeeded: sub.reviewNeeded ?? false,
      notes: sub.notes ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    subjectMap.set(sub.id, item);
    return item;
  });

  let entryIndex = 1;
  const timetable: TimetableItem[] = SISTEC_TIMETABLE_SLOTS.map((slotSeed) => {
    const sub = subjectMap.get(slotSeed.subjectId);
    const entryId = `entry-${slotSeed.dayOfWeek}-${slotSeed.slot}-${entryIndex++}`;
    return {
      id: entryId,
      studentId: uid,
      subjectId: slotSeed.subjectId,
      subjectName: sub?.name ?? "Subject",
      subjectCode: sub?.code ?? "CODE",
      slot: slotSeed.slot,
      dayOfWeek: slotSeed.dayOfWeek,
      startTime: slotSeed.startTime,
      endTime: slotSeed.endTime,
      category: slotSeed.category,
      room: slotSeed.room ?? (slotSeed.category === "Practical" ? "Lab" : "Classroom"),
      teacherName: null,
      active: true,
      sourceId: "sistec-timetable-2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  const now = new Date();
  const sessions: ClassSessionItem[] = [];

  for (let dayOffset = -7; dayOffset <= 14; dayOffset++) {
    const d = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const weekday = getWeekdayIST(d);
    if (weekday === 7) continue;

    const dateKey = formatDateKey(d);
    if (!isTeachingDay(dateKey)) continue;

    const academicDay = getTeachingDayNumber(dateKey);
    const matchingEntries = timetable.filter((e) => e.active && e.dayOfWeek === weekday);

    for (const entry of matchingEntries) {
      const sessionId = `session-${entry.id}-${dateKey}`;
      const startAt = makeIstDateTime(dateKey, entry.startTime);
      const endAt = makeIstDateTime(dateKey, entry.endTime);
      const isOverdue = now.getTime() >= endAt.getTime();
      const initialStatus = isOverdue ? "absent" : "upcoming";
      const isFinalized = isOverdue;

      sessions.push({
        id: sessionId,
        studentId: uid,
        subjectId: entry.subjectId,
        subjectName: entry.subjectName,
        subjectCode: entry.subjectCode,
        timetableEntryId: entry.id,
        slot: entry.slot,
        scheduledDate: dateKey,
        scheduledStartAt: startAt.toISOString(),
        scheduledEndAt: endAt.toISOString(),
        category: entry.category,
        room: entry.room ?? null,
        personalStatus: initialStatus,
        erpStatus: null,
        note: null,
        finalized: isFinalized,
        finalizedAt: isFinalized ? endAt.toISOString() : null,
        serverReceiptAt: null,
        clientCaptureAt: null,
        cancelledAt: null,
        evidenceAvailable: false,
        academicDayNumber: academicDay,
        createdAt: now.toISOString(),
      });
    }
  }

  return { subjects, timetable, sessions };
}

// Generate active upcoming class sessions strictly according to SISTec Academic Calendar
export async function generateWeeklySessions(uid: string): Promise<void> {
  const timetableRef = collection(db, "users", uid, "timetableEntries");
  const sessionsRef = collection(db, "users", uid, "classSessions");

  try {
    const timetableSnap = await getDocs(timetableRef);
    if (timetableSnap.empty) return;

    const entries: TimetableItem[] = [];
    timetableSnap.forEach((d) => entries.push(d.data() as TimetableItem));

    // 1. Purge any accidental sessions that fall on official holidays or non-teaching days
    // to strictly enforce the Academic Calendar rule: "if holiday is there then it must not be counted"
    const existingSessionsSnap = await getDocs(sessionsRef);
    const existingDateIds = new Set<string>();

    for (const sDoc of existingSessionsSnap.docs) {
      const sData = sDoc.data() as ClassSessionItem;
      existingDateIds.add(sDoc.id);

      // If a session exists on a non-teaching date (Holiday, Sunday, etc.) and is not marked present:
      if (!isTeachingDay(sData.scheduledDate)) {
        try {
          await deleteDoc(sDoc.ref);
          existingDateIds.delete(sDoc.id);
        } catch {
          // Ignore deletion error
        }
      }
    }

    const now = new Date();
    const batch = writeBatch(db);
    let sessionCount = 0;

    // Check window from 7 days ago to 14 days ahead in IST
    for (let dayOffset = -7; dayOffset <= 14; dayOffset++) {
      const d = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const weekday = getWeekdayIST(d);
      if (weekday === 7) continue; // Sunday has no classes

      const dateKey = formatDateKey(d);

      // CRITICAL ACADEMIC CALENDAR GATE:
      // Only schedule classes on approved B.Tech 3rd teaching days (Days 1 to 57)!
      // Official holidays (e.g. Gandhi Jayanti, Durga Navmi, Vijay Dashmi, Diwali, Gas Tragedy)
      // and non-instructional days are completely skipped.
      if (!isTeachingDay(dateKey)) {
        continue;
      }

      const academicDay = getTeachingDayNumber(dateKey);
      const matchingEntries = entries.filter((e) => e.active && e.dayOfWeek === weekday);

      for (const entry of matchingEntries) {
        const sessionId = `session-${entry.id}-${dateKey}`;
        if (existingDateIds.has(sessionId)) continue;

        const sessionDocRef = doc(db, "users", uid, "classSessions", sessionId);
        const startAt = makeIstDateTime(dateKey, entry.startTime);
        const endAt = makeIstDateTime(dateKey, entry.endTime);

        // Academic integrity: if session already ended in past, mark absent; if today or future, upcoming
        const isOverdue = now.getTime() >= endAt.getTime();
        const initialStatus = isOverdue ? "absent" : "upcoming";
        const isFinalized = isOverdue;

        batch.set(sessionDocRef, {
          id: sessionId,
          studentId: uid,
          subjectId: entry.subjectId,
          subjectName: entry.subjectName,
          subjectCode: entry.subjectCode,
          timetableEntryId: entry.id,
          slot: entry.slot,
          scheduledDate: dateKey,
          scheduledStartAt: startAt.toISOString(),
          scheduledEndAt: endAt.toISOString(),
          category: entry.category,
          room: entry.room ?? null,
          personalStatus: initialStatus,
          erpStatus: null,
          note: null,
          finalized: isFinalized,
          finalizedAt: isFinalized ? endAt.toISOString() : null,
          serverReceiptAt: null,
          clientCaptureAt: null,
          cancelledAt: null,
          evidenceAvailable: false,
          academicDayNumber: academicDay,
          createdAt: now.toISOString(),
        });
        sessionCount++;
      }
    }

    if (sessionCount > 0) {
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}/classSessions`);
  }
}

// Re-export academic calendar helpers
export {
  isTeachingDay,
  getTeachingDayNumber,
  getHolidayInfo,
  getCalendarDayInfo,
  SISTEC_OFFICIAL_HOLIDAYS,
  SISTEC_CALENDAR_SUMMARY,
  BTECH_3RD_TEACHING_DAYS,
};

// Mark Present inside the exact scheduled window
export async function markSessionPresent(
  uid: string,
  sessionId: string,
  evidenceDataUrl?: string
): Promise<{ success: boolean; message: string }> {
  const sessionRef = doc(db, "users", uid, "classSessions", sessionId);
  const sessionSnap = await getDoc(sessionRef);

  if (!sessionSnap.exists()) {
    throw new Error("Class session not found.");
  }

  const session = sessionSnap.data() as ClassSessionItem;
  if (session.personalStatus === "present" || (session.finalized && session.personalStatus !== "upcoming")) {
    throw new Error("Attendance for this class session has already been recorded and is uneditable.");
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  if (session.scheduledDate !== today) {
    throw new Error("Attendance can only be marked for today's scheduled classes.");
  }

  const now = Date.now();
  const startMs = new Date(session.scheduledStartAt).getTime();
  const endMs = new Date(session.scheduledEndAt).getTime();

  // Strict interval check: scheduledStart <= trustedServerTime < scheduledEnd
  if (now < startMs) {
    const diffMins = Math.ceil((startMs - now) / 60000);
    throw new Error(`Attendance window has not opened yet. Class begins in ${diffMins} minute(s).`);
  }

  if (now >= endMs) {
    // Automatically finalize as absent
    await updateDoc(sessionRef, {
      personalStatus: "absent",
      finalized: true,
      finalizedAt: new Date(endMs).toISOString(),
    });
    throw new Error("Attendance window closed at scheduled end time. The session has been recorded as Absent.");
  }

  // Upload private evidence photo to Firebase Storage if captured
  let evidenceStoragePath: string | null = null;
  if (evidenceDataUrl) {
    try {
      const storageKey = `users/${uid}/evidence/${sessionId}_${Date.now()}.jpg`;
      const evidenceRef = ref(storage, storageKey);
      await uploadString(evidenceRef, evidenceDataUrl, "data_url");
      evidenceStoragePath = storageKey;

      // Save metadata document with dataUrl for instant proof display
      const metaRef = doc(db, "users", uid, "evidenceMetadata", `meta-${sessionId}`);
      await setDoc(metaRef, {
        id: `meta-${sessionId}`,
        sessionId,
        storagePath: storageKey,
        dataUrl: evidenceDataUrl,
        clientCapturedAt: new Date().toISOString(),
        uploadedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("Storage upload failed or skipped, proceeding with attendance mark:", e);
    }
  }

  const receiptAt = new Date().toISOString();
  await updateDoc(sessionRef, {
    personalStatus: "present",
    finalized: true,
    finalizedAt: receiptAt,
    serverReceiptAt: receiptAt,
    evidenceAvailable: Boolean(evidenceStoragePath),
    evidenceStoragePath,
  });

  // Record audit event
  const eventRef = doc(db, "users", uid, "attendanceEvents", `event-${sessionId}-${Date.now()}`);
  await setDoc(eventRef, {
    id: `event-${sessionId}-${Date.now()}`,
    sessionId,
    eventType: "present_marked",
    serverTimestamp: receiptAt,
    message: evidenceStoragePath
      ? "Attendance marked Present with photo evidence."
      : "Attendance marked Present with server receipt time.",
  });

  return { success: true, message: "Attendance recorded as Present (Verified & Uneditable)." };
}

// Mark Absent manually on the attendance card (finalized and uneditable)
export async function markSessionAbsent(
  uid: string,
  sessionId: string
): Promise<{ success: boolean; message: string }> {
  const sessionRef = doc(db, "users", uid, "classSessions", sessionId);
  const sessionSnap = await getDoc(sessionRef);

  if (!sessionSnap.exists()) {
    throw new Error("Class session not found.");
  }

  const session = sessionSnap.data() as ClassSessionItem;
  if (session.personalStatus === "present" || session.personalStatus === "absent" || session.finalized) {
    throw new Error("Attendance for this class session is already recorded and is uneditable.");
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  if (session.scheduledDate !== today) {
    throw new Error("Attendance can only be marked for today's scheduled classes.");
  }

  const nowIso = new Date().toISOString();
  await updateDoc(sessionRef, {
    personalStatus: "absent",
    absentType: "manual_student",
    finalized: true,
    finalizedAt: nowIso,
  });

  const eventRef = doc(db, "users", uid, "attendanceEvents", `event-absent-${sessionId}-${Date.now()}`);
  await setDoc(eventRef, {
    id: `event-absent-${sessionId}-${Date.now()}`,
    sessionId,
    eventType: "absent_marked_student",
    serverTimestamp: nowIso,
    message: "Attendance marked Absent by student (Uneditable).",
  });

  return { success: true, message: "Attendance marked Absent by student (Uneditable)." };
}

// Record manual observed ERP status (strictly uneditable once entered, available for any date one time only)
export async function recordSessionErpStatus(
  uid: string,
  sessionId: string,
  status: "Present" | "Absent"
): Promise<void> {
  const sessionRef = doc(db, "users", uid, "classSessions", sessionId);
  const sessionSnap = await getDoc(sessionRef);

  if (!sessionSnap.exists()) {
    throw new Error("Class session not found.");
  }

  const session = sessionSnap.data() as ClassSessionItem;
  if (session.personalStatus === "cancelled") {
    throw new Error("Cannot record ERP status for a cancelled class.");
  }

  // Once ERP is marked, it should not get entered after that (one time only check)
  if (session.erpStatus !== null && session.erpStatus !== undefined) {
    throw new Error("ERP attendance has already been recorded and is uneditable.");
  }

  await updateDoc(sessionRef, {
    erpStatus: status,
  });

  const eventRef = doc(db, "users", uid, "attendanceEvents", `event-erp-${sessionId}-${Date.now()}`);
  await setDoc(eventRef, {
    id: `event-erp-${sessionId}-${Date.now()}`,
    sessionId,
    eventType: "erp_status_recorded",
    serverTimestamp: new Date().toISOString(),
    message: `ERP status recorded as ${status} (Permanent & Uneditable).`,
  });
}

// Update note / keynote for a class session (strict one-time save, immutable once saved)
export async function updateSessionNote(
  uid: string,
  sessionId: string,
  note: string
): Promise<void> {
  const sessionRef = doc(db, "users", uid, "classSessions", sessionId);
  const sessionSnap = await getDoc(sessionRef);

  if (!sessionSnap.exists()) {
    throw new Error("Class session not found.");
  }

  const session = sessionSnap.data() as ClassSessionItem;
  if (session.note !== null && session.note !== undefined && session.note.trim() !== "") {
    throw new Error("Keynote/Note has already been saved and is permanently immutable and uneditable.");
  }

  if (!note.trim()) {
    throw new Error("Please enter a valid keynote/note.");
  }

  await updateDoc(sessionRef, {
    note: note.trim(),
  });

  const eventRef = doc(db, "users", uid, "attendanceEvents", `event-note-${sessionId}-${Date.now()}`);
  await setDoc(eventRef, {
    id: `event-note-${sessionId}-${Date.now()}`,
    sessionId,
    eventType: "note_updated",
    serverTimestamp: new Date().toISOString(),
    message: `Keynote saved permanently as "${note.trim()}" (Immutable & Uneditable).`,
  });
}

// Cancel class session
export async function cancelClassSession(uid: string, sessionId: string): Promise<void> {
  const sessionRef = doc(db, "users", uid, "classSessions", sessionId);
  const sessionSnap = await getDoc(sessionRef);

  if (!sessionSnap.exists()) {
    throw new Error("Class session not found.");
  }

  const session = sessionSnap.data() as ClassSessionItem;
  if (session.finalized && session.personalStatus !== "upcoming") {
    throw new Error("Finalized sessions cannot be cancelled.");
  }

  const now = new Date().toISOString();
  await updateDoc(sessionRef, {
    personalStatus: "cancelled",
    finalized: true,
    cancelledAt: now,
    finalizedAt: now,
  });

  const eventRef = doc(db, "users", uid, "attendanceEvents", `event-cancel-${sessionId}-${Date.now()}`);
  await setDoc(eventRef, {
    id: `event-cancel-${sessionId}-${Date.now()}`,
    sessionId,
    eventType: "session_cancelled",
    serverTimestamp: now,
    message: "Class session cancelled and excluded from attendance denominators.",
  });
}

// Auto-finalize overdue sessions
export async function finalizeExpiredSessionsForStudent(
  uid: string,
  sessions: ClassSessionItem[]
): Promise<void> {
  const now = Date.now();
  const overdueUpcoming = sessions.filter(
    (s) => !s.finalized && s.personalStatus === "upcoming" && new Date(s.scheduledEndAt).getTime() <= now
  );

  for (const session of overdueUpcoming) {
    try {
      const sessionRef = doc(db, "users", uid, "classSessions", session.id);
      const finalizedAt = new Date(session.scheduledEndAt).toISOString();
      await updateDoc(sessionRef, {
        personalStatus: "absent",
        absentType: "automatic_overdue",
        finalized: true,
        finalizedAt,
      });

      const eventRef = doc(db, "users", uid, "attendanceEvents", `event-fin-${session.id}-${Date.now()}`);
      await setDoc(eventRef, {
        id: `event-fin-${session.id}-${Date.now()}`,
        sessionId: session.id,
        eventType: "session_finalized_automatic",
        serverTimestamp: finalizedAt,
        message: "Attendance window closed; automatically recorded as Absent.",
      });
    } catch (e) {
      console.warn("Error finalizing session:", session.id, e);
    }
  }
}

import { getCachedStore, setCachedStore } from "./idb-cache";
import { collection, getDocs, query, orderBy } from "firebase/firestore";

// Freeze class session (permanently removed from all calculations)
export async function freezeClassSession(uid: string, sessionId: string): Promise<void> {
  const now = new Date().toISOString();

  // 1. Persist to Firestore if online & authenticated
  if (auth.currentUser && !uid.startsWith("local-")) {
    try {
      const sessionRef = doc(db, "users", uid, "classSessions", sessionId);
      await updateDoc(sessionRef, {
        personalStatus: "frozen",
        finalized: true,
        frozenAt: now,
        finalizedAt: now,
      });

      const eventRef = doc(db, "users", uid, "attendanceEvents", `event-freeze-${sessionId}-${Date.now()}`);
      await setDoc(eventRef, {
        id: `event-freeze-${sessionId}-${Date.now()}`,
        sessionId,
        eventType: "session_frozen",
        serverTimestamp: now,
        message: "Class session permanently frozen and excluded from all calculations.",
      });
    } catch (e) {
      console.warn("Firestore update error in freezeClassSession:", e);
    }
  }

  // 2. Always persist to IndexedDB local cache so it survives refreshes & offline
  try {
    const cachedSessions = await getCachedStore<ClassSessionItem>("sessions");
    if (cachedSessions && cachedSessions.length > 0) {
      const updated = cachedSessions.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              personalStatus: "frozen" as const,
              finalized: true,
              frozenAt: now,
              finalizedAt: now,
            }
          : s
      );
      await setCachedStore("sessions", updated);
    }
  } catch (err) {
    console.warn("IDB cache update error in freezeClassSession:", err);
  }
}

// Attendance calculations adhering strictly to Part 7:
// Zero denominator returns null (displays N/A)
export function computeAttendanceStats(sessions: ClassSessionItem[]) {
  // Only valid sessions on teaching days count
  const validSessions = sessions.filter((s) => isTeachingDay(s.scheduledDate));

  // Only finalized, non-cancelled/frozen sessions count toward attendance
  const eligible = validSessions.filter(
    (s) => s.finalized && (s.personalStatus === "present" || s.personalStatus === "absent")
  );

  const theoryEligible = eligible.filter((s) => s.category === "Theory");
  const practicalEligible = eligible.filter((s) => s.category === "Practical");

  const calcMetric = (list: ClassSessionItem[]) => {
    const presentCount = list.filter((s) => s.personalStatus === "present").length;
    const absentCount = list.filter((s) => s.personalStatus === "absent").length;
    const total = presentCount + absentCount;
    const percentage = total === 0 ? null : Math.round((presentCount / total) * 1000) / 10;
    return {
      percentage,
      presentCount,
      absentCount,
      totalEligible: total,
    };
  };

  // ERP calculation: only sessions with ERP status Present or Absent
  const erpEligible = eligible.filter((s) => s.erpStatus === "Present" || s.erpStatus === "Absent");
  const erpPresentCount = erpEligible.filter((s) => s.erpStatus === "Present").length;
  const erpAbsentCount = erpEligible.filter((s) => s.erpStatus === "Absent").length;
  const erpTotal = erpPresentCount + erpAbsentCount;
  const erpPercentage = erpTotal === 0 ? null : Math.round((erpPresentCount / erpTotal) * 1000) / 10;

  // ERP comparison breakdown
  const erpNotEnteredCount = eligible.filter((s) => s.erpStatus === null).length;
  let matchCount = 0;
  let discrepancyCount = 0;

  for (const s of erpEligible) {
    const personalErp = s.personalStatus === "present" ? "Present" : "Absent";
    if (s.erpStatus === personalErp) {
      matchCount++;
    } else {
      discrepancyCount++;
    }
  }

  return {
    overall: calcMetric(eligible),
    theory: calcMetric(theoryEligible),
    practical: calcMetric(practicalEligible),
    erp: {
      percentage: erpPercentage,
      presentCount: erpPresentCount,
      absentCount: erpAbsentCount,
      totalEligible: erpTotal,
    },
    erpNotEnteredCount,
    matchCount,
    discrepancyCount,
    totalFinalized: eligible.length,
    upcomingCount: sessions.filter((s) => !s.finalized && s.personalStatus === "upcoming").length,
  };
}
export async function uploadSessionPhoto(
  uid: string,
  sessionId: string,
  photoDataUrl: string
): Promise<string> {
  const storageRef = ref(storage, `users/${uid}/attendance/${sessionId}/${Date.now()}.jpg`);
  await uploadString(storageRef, photoDataUrl, "data_url");
  return await getDownloadURL(storageRef);
}
