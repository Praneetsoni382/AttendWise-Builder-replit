import {
  type ComponentType,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CalendarRange,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  TableProperties,
  User,
  Video,
  X,
  XCircle,
} from "lucide-react";
import AcademicCalendarView from "./pages/academic-calendar";
import {
  getCalendarDayInfo,
  SISTEC_OFFICIAL_HOLIDAYS,
  isTeachingDay,
  getTeachingDayNumber,
} from "./data/sistec-calendar";
import {
  auth,
  db,
  signUpStudent,
  signInStudent,
  signInWithGoogle,
  resetStudentPassword,
  logOutStudent,
  ensureSistecTimetableLoaded,
  syncTimetableSlotTimings,
  markSessionPresent,
  markSessionAbsent,
  recordSessionErpStatus,
  updateSessionNote,
  freezeClassSession,
  cancelClassSession,
  finalizeExpiredSessionsForStudent,
  computeAttendanceStats,
  formatDateKey,
  getWeekdayIST,
  TIMEZONE,
  handleFirestoreError,
  OperationType,
  type StudentProfile,
  type SubjectItem,
  type TimetableItem,
  type ClassSessionItem,
  type AttendanceEventItem,
} from "./lib/firebase";
import { SISTEC_METADATA, SISTEC_TIME_SLOTS } from "./data/sistec-timetable";
import { Button } from "@workspace/attendwise-design-system/components/ui/button";
import { Badge } from "@workspace/attendwise-design-system/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/attendwise-design-system/components/ui/card";
import { Progress } from "@workspace/attendwise-design-system/components/ui/progress";
import { Input } from "@workspace/attendwise-design-system/components/ui/input";
import { Label } from "@workspace/attendwise-design-system/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/attendwise-design-system/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/attendwise-design-system/components/ui/dialog";
import { Skeleton } from "@workspace/attendwise-design-system/components/ui/skeleton";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/attendwise-design-system/components/ui/alert";
import { Separator } from "@workspace/attendwise-design-system/components/ui/separator";
import { TooltipProvider } from "@workspace/attendwise-design-system/components/ui/tooltip";
import { Toaster } from "@workspace/attendwise-design-system/components/ui/toaster";
import { ErrorBoundary } from "@/components/error-boundary";
import NotFound from "@/pages/not-found";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  addDoc,
  setDoc,
} from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";

const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});
const timeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const safeDate = (val?: unknown): Date | null => {
  if (val === null || val === undefined || val === "") return null;
  try {
    if (val instanceof Date) {
      return isNaN(val.getTime()) ? null : val;
    }
    const d = new Date(val as any);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

const formatDate = (val?: unknown) => {
  try {
    const d = safeDate(val);
    return d ? dateFmt.format(d) : "—";
  } catch {
    return "—";
  }
};

const formatDateTime = (val?: unknown) => {
  try {
    const d = safeDate(val);
    return d ? `${dateTimeFmt.format(d)} IST` : "—";
  } catch {
    return "—";
  }
};

const formatTime = (val?: unknown) => {
  try {
    const d = safeDate(val);
    return d ? `${timeFmt.format(d)} IST` : "—";
  } catch {
    return "—";
  }
};

const formatClock = (val?: unknown): string => {
  if (val === null || val === undefined || val === "") return "—";
  try {
    if (val instanceof Date) {
      if (isNaN(val.getTime())) return "—";
      return timeFmt.format(val);
    }
    if (typeof val === "number") {
      const d = new Date(val);
      if (isNaN(d.getTime())) return "—";
      return timeFmt.format(d);
    }
    const str = String(val).trim();
    // Handle standard HH:mm or HH:mm:ss format with optional AM/PM
    const timeMatch = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(AM|PM))?$/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      const meridiem = timeMatch[3]?.toUpperCase();
      if (meridiem === "PM" && h < 12) h += 12;
      if (meridiem === "AM" && h === 12) h = 0;
      if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        const period = h >= 12 ? "PM" : "AM";
        const hour12 = h % 12 === 0 ? 12 : h % 12;
        const minuteStr = m < 10 ? `0${m}` : `${m}`;
        return `${hour12}:${minuteStr} ${period}`;
      }
    }
    const d = safeDate(str);
    if (d) {
      return timeFmt.format(d);
    }
    return str || "—";
  } catch {
    return String(val || "—");
  }
};

// Continuous Live Clock synced to Indian Standard Time (IST)
function LiveServerClock({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  let timeStr = "";
  let dateStr = "";
  try {
    timeStr = new Intl.DateTimeFormat("en-IN", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(now);
    dateStr = new Intl.DateTimeFormat("en-IN", {
      timeZone: TIMEZONE,
      weekday: "short",
      day: "2-digit",
      month: "short",
    }).format(now);
  } catch {
    timeStr = now.toLocaleTimeString("en-IN");
    dateStr = now.toLocaleDateString("en-IN");
  }

  if (compact) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs"
        title="Live Indian Standard Time (IST)"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span className="font-mono text-xs font-semibold tracking-tight text-foreground">
          {timeStr}
        </span>
        <span className="text-[10px] text-muted-foreground font-semibold">IST</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border border-primary/25 bg-card/95 px-3 py-2 shadow-xs backdrop-blur-sm"
      title="Indian Standard Time (IST) - Authoritative Server Sync Clock"
    >
      <div className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
      </div>
      <div className="leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Server Clock (IST)
          </span>
          <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
            REALTIME
          </span>
        </div>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className="font-mono text-xs sm:text-sm font-bold tracking-tight text-foreground">
            {timeStr}
          </span>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            · {dateStr}
          </span>
        </div>
      </div>
    </div>
  );
}

const asPct = (value: number | null | undefined) =>
  value === null || value === undefined ? "N/A" : `${Math.round(value)}%`;

const isSessionInWindow = (session: ClassSessionItem, nowMs: number = Date.now()) => {
  if (session.finalized || session.personalStatus === "cancelled") return false;
  const startMs = new Date(session.scheduledStartAt).getTime();
  const endMs = new Date(session.scheduledEndAt).getTime();
  return !isNaN(startMs) && !isNaN(endMs) && nowMs >= startMs && nowMs < endMs;
};

const sessionStatusLabel = (session: ClassSessionItem, nowMs: number = Date.now()) => {
  if (session.personalStatus === "present") return "Present";
  if (session.personalStatus === "cancelled") return "Cancelled";
  if (session.personalStatus === "absent") {
    return session.absentType === "manual_student" ? "Marked Absent by Student" : "Automatically Marked Absent";
  }
  if (isSessionInWindow(session, nowMs)) return "In Run";
  const endMs = new Date(session.scheduledEndAt).getTime();
  if (!isNaN(endMs) && nowMs >= endMs) {
    return "Automatically Marked Absent";
  }
  return "Upcoming";
};

function StateBadge({ status, children }: { status: string; children: ReactNode }) {
  const isPresent = status === "present" || status === "Present" || status === "match";
  const isAbsent = status === "absent" || status === "Absent" || status === "Automatically marked Absent";
  const isInRun = status === "in_run" || status === "In Run";
  const isDiscrepancy = status === "potential_discrepancy";

  const color = isPresent
    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-medium"
    : isAbsent
    ? "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-400 font-medium"
    : isInRun
    ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold animate-pulse"
    : isDiscrepancy
    ? "border-chart-4/30 bg-chart-4/15 text-chart-4 font-medium"
    : "border-border bg-muted/40 text-muted-foreground";

  return <Badge variant="outline" className={color}>{children}</Badge>;
}

function LoadingBlock() {
  return (
    <div className="space-y-4" aria-label="Loading">
      <Skeleton className="h-10 w-1/3" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/40 px-5 py-10 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-secondary/20 text-primary">
        <BookOpen className="h-5 w-5" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

// Protected Application Shell
function Shell({
  children,
  profile,
  onLogout,
}: {
  children: ReactNode;
  profile?: StudentProfile | null;
  onLogout: () => void;
}) {
  const [path] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const navItems = [
    { href: "/dashboard", title: "Dashboard", icon: LayoutDashboard },
    { href: "/timetable", title: "My Timetable", icon: CalendarDays },
    { href: "/calendar", title: "Academic Calendar", icon: CalendarRange },
    { href: "/history", title: "Attendance History", icon: Activity },
    { href: "/subjects", title: "Subjects", icon: BookOpen },
    { href: "/comparison", title: "ERP Comparison", icon: TableProperties },
    { href: "/profile", title: "Profile & Settings", icon: Settings },
  ];

  const initials =
    profile?.displayName
      ?.split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "ST";

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      <aside
        className={`${
          mobileNav ? "block" : "hidden"
        } fixed inset-y-0 left-0 z-40 w-72 border-r bg-card p-5 md:sticky md:top-0 md:block md:h-screen md:w-64 md:shrink-0 flex flex-col justify-between`}
      >
        <div>
          <Link href="/dashboard" className="mb-8 flex items-center gap-3 rounded-md font-semibold" data-testid="link-brand">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <GraduationCap className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <span className="text-lg font-bold tracking-tight block leading-tight">AttendWise</span>
              <span className="block text-xs font-normal text-muted-foreground truncate">
                SISTec · AIDS 3 Sem
              </span>
            </div>
          </Link>
          <nav className="space-y-1" aria-label="Main navigation">
            {navItems.map(({ href, title, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileNav(false)}
                data-testid={`link-nav-${href.slice(1)}`}
                className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors ${
                  path === href || (href === "/history" && path.startsWith("/session/"))
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {title}
              </Link>
            ))}
          </nav>

          <div className="mt-8 rounded-lg border bg-muted/40 p-3.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 font-medium text-foreground mb-1">
              <ShieldCheck className="h-3.5 w-3.5 text-accent-foreground" />
              <span>Firebase Synced</span>
            </div>
            <p className="leading-relaxed">
              Real-time Firestore storage. Timetable sourced from SISTec 16/10/2026 report.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between rounded-lg border bg-card p-3 shadow-xs">
          <div className="min-w-0 flex-1 mr-2">
            <p className="truncate text-sm font-semibold">{profile?.displayName || "Student"}</p>
            <p className="truncate text-xs text-muted-foreground">{profile?.email || "Authenticated"}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            title="Sign out"
            onClick={onLogout}
            data-testid="button-exit-demo"
          >
            <LogOut className="h-4 w-4 text-muted-foreground hover:text-destructive" />
          </Button>
        </div>
      </aside>

      {mobileNav ? (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-foreground/30 md:hidden"
          onClick={() => setMobileNav(false)}
        />
      ) : null}

      <div className="min-w-0 flex-1 flex flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur sm:px-7">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="hidden text-sm text-muted-foreground sm:block">
              AttendWise <span className="px-1">/</span>{" "}
              <span className="text-foreground font-medium">
                {navItems.find((item) => item.href === path)?.title ?? "Session details"}
              </span>
            </div>
            <Badge variant="outline" className="sm:hidden font-mono text-[10px]">
              SISTec AIDS
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block">
              <LiveServerClock compact />
            </div>
            <Link href="/profile" className="flex items-center gap-2">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary/20 text-sm font-semibold text-primary"
                aria-label="Student profile"
              >
                {initials}
              </span>
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-7 sm:py-8 flex-1">{children}</main>
        <footer className="px-4 py-4 text-center text-xs text-muted-foreground sm:px-7 border-t">
          AttendWise is an authenticated student tracking companion for SISTec (AIDS 3rd Sem). Records do not replace official college ERP logs.
        </footer>
      </div>
    </div>
  );
}

// Authentication & Welcome Screen
function AuthWelcome({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [resetMsg, setResetMsg] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      if (mode === "signup") {
        if (!name.trim()) throw new Error("Please enter your full name.");
        await signUpStudent(email.trim(), password, name.trim());
      } else {
        await signInStudent(email.trim(), password);
      }
      onAuthSuccess();
    } catch (err: any) {
      setError(err?.message?.replace(/^Firebase:\s*/, "") || "Authentication failed. Check your credentials.");
    } finally {
      setPending(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setPending(true);
    try {
      await signInWithGoogle();
      onAuthSuccess();
    } catch (err: any) {
      setError(err?.message?.replace(/^Firebase:\s*/, "") || "Google sign-in could not be completed.");
    } finally {
      setPending(false);
    }
  };

  const handlePasswordReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    try {
      await resetStudentPassword(resetEmail.trim());
      setResetMsg(`Password reset link sent to ${resetEmail}. Check your inbox.`);
    } catch (err: any) {
      setResetMsg(err?.message?.replace(/^Firebase:\s*/, "") || "Could not send reset email.");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="grid w-full max-w-5xl items-center gap-12 lg:grid-cols-2">
        <section className="order-2 text-center lg:order-1 lg:text-left">
          <div className="mb-6 inline-flex items-center gap-3 font-semibold">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
              <GraduationCap className="h-7 w-7" />
            </span>
            <div>
              <span className="text-2xl font-bold tracking-tight block">AttendWise</span>
              <span className="text-xs text-muted-foreground font-normal">College Attendance Companion</span>
            </div>
          </div>

          <Badge variant="outline" className="mb-4 bg-muted/50 border-secondary/30">
            SISTec Gandhinagar · AIDS 3 SEM 2 YR
          </Badge>

          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl text-foreground">
            Your attendance,<br className="hidden sm:block" /> organized and verified.
          </h1>

          <p className="mx-auto mt-4 max-w-lg text-sm sm:text-base leading-relaxed text-muted-foreground lg:mx-0">
            Track daily class slots, log exact attendance during scheduled lecture intervals, and compare personal records with your college ERP.
          </p>

          <Card className="mt-8 text-left max-w-md mx-auto lg:mx-0 shadow-sm border-border/80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">
                  {mode === "signin" ? "Student Sign In" : "Create Student Account"}
                </CardTitle>
                <button
                  type="button"
                  className="text-xs text-primary font-medium hover:underline"
                  onClick={() => {
                    setMode(mode === "signin" ? "signup" : "signin");
                    setError("");
                  }}
                >
                  {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {error ? (
                <Alert variant="destructive" className="mb-4 py-2 text-xs">
                  <CircleAlert className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <form onSubmit={handleSubmit} className="space-y-3.5">
                {mode === "signup" ? (
                  <div className="space-y-1">
                    <Label htmlFor="auth-name" className="text-xs">Full Name</Label>
                    <Input
                      id="auth-name"
                      placeholder="e.g. Praneet Soni"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                ) : null}

                <div className="space-y-1">
                  <Label htmlFor="auth-email" className="text-xs">College Email</Label>
                  <Input
                    id="auth-email"
                    type="email"
                    placeholder="student@sistec.ac.in"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="auth-pass" className="text-xs">Password</Label>
                    {mode === "signin" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setResetEmail(email);
                          setResetMsg("");
                          setResetOpen(true);
                        }}
                        className="text-[11px] text-muted-foreground hover:text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    ) : null}
                  </div>
                  <Input
                    id="auth-pass"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                </div>

                <Button type="submit" disabled={pending} className="w-full mt-2 font-medium">
                  {pending ? "Authenticating…" : mode === "signin" ? "Sign In to AttendWise" : "Create Account & Load Timetable"}
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Button>

                <div className="relative my-3 text-center text-xs">
                  <Separator />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-muted-foreground">
                    or
                  </span>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGoogle}
                  disabled={pending}
                  className="w-full text-xs font-normal"
                >
                  <span className="font-semibold text-primary mr-1.5">G</span> Continue with Google
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>

        <section className="order-1 mx-auto w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm lg:order-2">
          <div className="flex items-center justify-between border-b pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">SISTec Bhopal</p>
              <p className="text-sm font-medium">AIDS 3 SEM 2 YR Schedule</p>
            </div>
            <CalendarDays className="h-5 w-5 text-secondary" />
          </div>

          <div className="mt-4 space-y-2.5">
            <div className="rounded-lg bg-muted/60 p-3 text-xs">
              <span className="font-semibold text-foreground">6 Slots per Day · IST:</span>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                <li>• P1: 9:35 AM – 10:35 AM</li>
                <li>• P2: 10:35 AM – 11:35 AM</li>
                <li>• P3: 11:35 AM – 12:35 PM</li>
                <li>• P4: 12:35 PM – 1:35 PM</li>
                <li>• Lunch Break: 1:35 PM – 2:10 PM</li>
                <li>• P5: 2:10 PM – 3:10 PM</li>
                <li>• P6: 3:10 PM – 4:10 PM</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border bg-card p-2.5 text-xs">
                <div>
                  <span className="font-semibold">AD-302</span> Probability & Statistics
                  <span className="block text-[11px] text-muted-foreground">Theory · Mon/Tue/Wed/Thu</span>
                </div>
                <Badge variant="outline" className="text-[10px]">Theory</Badge>
              </div>

              <div className="flex items-center justify-between rounded-lg border bg-card p-2.5 text-xs">
                <div>
                  <span className="font-semibold">AD-305</span> Object Oriented Programming
                  <span className="block text-[11px] text-muted-foreground">Practical · Consecutive slots</span>
                </div>
                <Badge variant="outline" className="text-[10px] bg-secondary/10 text-secondary">Practical</Badge>
              </div>

              <div className="flex items-center justify-between rounded-lg border bg-card p-2.5 text-xs">
                <div>
                  <span className="font-semibold">AD-304</span> Artificial Intelligence
                  <span className="block text-[11px] text-muted-foreground">Theory & Practical labs</span>
                </div>
                <Badge variant="outline" className="text-[10px]">Theory / Lab</Badge>
              </div>
            </div>
          </div>

          <p className="mt-5 text-[11px] text-muted-foreground leading-relaxed flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            Your data is stored securely in Firebase under your authenticated student account.
          </p>
        </section>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Enter your college email address to receive a secure password reset link from Firebase.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePasswordReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="student@sistec.ac.in"
                required
              />
            </div>
            {resetMsg ? (
              <p className="text-xs text-muted-foreground leading-relaxed">{resetMsg}</p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResetOpen(false)}>
                Close
              </Button>
              <Button type="submit">Send Reset Email</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

// Summary metric card
function SummaryCard({
  title,
  percentage,
  note,
  icon: Icon,
  color,
}: {
  title: string;
  percentage: number | null;
  note: string;
  icon: typeof Activity;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight">{asPct(percentage)}</p>
          </div>
          <span className={`rounded-lg p-2.5 ${color}`}>
            <Icon className="h-5 w-5" />
          </span>
        </div>
        {percentage !== null ? (
          <Progress className="mt-4" value={percentage} aria-label={`${title} progress`} />
        ) : (
          <p className="mt-4 text-xs font-medium text-muted-foreground">No finalized classes yet</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function SessionLink({ session }: { session: ClassSessionItem }) {
  const status = sessionStatusLabel(session);
  return (
    <Link
      href={`/session/${session.id}`}
      className="flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted/60"
      data-testid={`link-session-${session.id}`}
    >
      <div className="hidden h-9 w-1 shrink-0 rounded-full bg-secondary sm:block" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="truncate text-sm font-semibold">{session.subjectName}</p>
          <Badge variant="outline" className="text-[10px] font-mono">
            {session.subjectCode}
          </Badge>
          {session.academicDayNumber ? (
            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
              Day {session.academicDayNumber}
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {session.slot ? `${session.slot} · ` : ""}
          {formatDate(session.scheduledDate)} · {formatTime(session.scheduledStartAt)} –{" "}
          {formatTime(session.scheduledEndAt)}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <StateBadge status={session.personalStatus}>{status}</StateBadge>
        {session.erpStatus ? (
          <Badge
            variant="outline"
            className={
              session.erpStatus === "Present"
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 text-[10px] font-medium"
                : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 text-[10px] font-medium"
            }
          >
            ERP {session.erpStatus}
          </Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground">ERP Not Recorded</span>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

// Interactive Attendance Card Dialog matching "Live Class Attendance" & "Attendance Details" mockup
function AttendanceCardDialog({
  open,
  onOpenChange,
  session,
  user,
  onRecordErp,
  onMarkPresent,
  onMarkAbsent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ClassSessionItem | null;
  user: FirebaseUser;
  onRecordErp?: (sessionId: string, status: "Present" | "Absent") => Promise<void>;
  onMarkPresent?: (sessionId: string, photoUrl?: string) => Promise<void>;
  onMarkAbsent?: (sessionId: string) => Promise<void>;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<AttendanceEventItem[]>([]);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [noteInput, setNoteInput] = useState(session?.note || "");
  const [evidencePhotoUrl, setEvidencePhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !session || !user || !session.evidenceAvailable) {
      setEvidencePhotoUrl(null);
      return;
    }
    const fetchEvidence = async () => {
      try {
        const metaSnap = await getDoc(doc(db, "users", user.uid, "evidenceMetadata", `meta-${session.id}`));
        if (metaSnap.exists()) {
          const data = metaSnap.data();
          if (data?.dataUrl) {
            setEvidencePhotoUrl(data.dataUrl);
          }
        }
      } catch (e) {
        console.warn("Could not load evidence metadata:", e);
      }
    };
    fetchEvidence();
  }, [open, session?.id, session?.evidenceAvailable, user?.uid]);

  useEffect(() => {
    setNoteInput(session?.note || "");
  }, [session?.id, session?.note]);

  const handleSaveNote = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateSessionNote(user.uid, session.id, noteInput);
      setNotice("Keynote/Note successfully saved and bounded to class attendance record.");
    } catch (err: any) {
      setError(err?.message || "Could not save note.");
    } finally {
      setBusy(false);
    }
  };

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const todayKey = formatDateKey(new Date());
  const isToday = session?.scheduledDate === todayKey;

  const nowMs = Date.now();
  const startMs = session ? new Date(session.scheduledStartAt).getTime() : 0;
  const endMs = session ? new Date(session.scheduledEndAt).getTime() : 0;
  const inWindow = Boolean(isToday && session && !session.finalized && nowMs >= startMs && nowMs < endMs);
  const isWindowOverdue = Boolean(
    session && (session.personalStatus === "absent" || (isToday && nowMs >= endMs))
  );

  // Active window countdown
  useEffect(() => {
    if (!open || !session || !inWindow) {
      setSecondsRemaining(null);
      return;
    }
    const updateCountdown = () => {
      const diff = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
      setSecondsRemaining(diff);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [open, session?.id, inWindow, endMs]);

  // Clean camera stream on modal close
  useEffect(() => {
    if (!open) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setCameraActive(false);
      setNotice(null);
      setError(null);
    }
  }, [open]);

  // Listen to authoritative attendance events in Firestore
  useEffect(() => {
    if (!open || !session || !user) return;
    const q = collection(db, "users", user.uid, "attendanceEvents");
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: AttendanceEventItem[] = [];
        snap.forEach((d) => {
          const item = d.data() as AttendanceEventItem;
          if (item.sessionId === session.id) list.push(item);
        });
        list.sort(
          (a, b) => new Date(b.serverTimestamp).getTime() - new Date(a.serverTimestamp).getTime()
        );
        setEvents(list);
      },
      () => {}
    );
    return () => unsub();
  }, [open, session?.id, user?.uid]);

  const startCamera = async () => {
    setError(null);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((e) => console.warn("Video play error:", e));
        }
      }, 150);
    } catch {
      setError(
        "Camera access was denied or no camera was found. Please allow camera permissions in your browser address bar / iframe settings."
      );
      setCameraActive(false);
    }
  };

  const snapPhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      setCapturedPhotoUrl(dataUrl);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const [stagedPersonalStatus, setStagedPersonalStatus] = useState<string | null>(null);
  const [stagedErpStatus, setStagedErpStatus] = useState<string | null>(null);
  const [stagedNote, setStagedNote] = useState<string>("");

  useEffect(() => {
    if (session) {
      setStagedPersonalStatus(session.personalStatus);
      setStagedErpStatus(session.erpStatus);
      setStagedNote(session.note || "");
    }
  }, [session?.id, session?.personalStatus, session?.erpStatus, session?.note]);

  const handleStagePresent = () => {
    setStagedPersonalStatus("present");
    setNotice("Staged: AttendWise attendance marked Present. Click 'Save Status' below to commit.");
    setError(null);
  };

  const handleStageAbsent = () => {
    setStagedPersonalStatus("absent");
    setNotice("Staged: AttendWise attendance marked Absent by student. Click 'Save Status' below to commit.");
    setError(null);
  };

  const handleStageErp = (status: "Present" | "Absent") => {
    setStagedErpStatus(status);
    setNotice(`Staged: ERP status recorded as ${status}. Click 'Save Status' below to commit.`);
    setError(null);
  };

  const handleStageNote = () => {
    if (!noteInput.trim()) return;
    setStagedNote(noteInput.trim());
    setNotice("Staged: Keynote note added. Click 'Save Status' below to commit.");
    setError(null);
  };

  const handleSaveAllStatus = async () => {
    if (!session || !user) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (stagedPersonalStatus === "present" && session.personalStatus !== "present") {
        if (onMarkPresent) {
          await onMarkPresent(session.id, capturedPhotoUrl || undefined);
        } else {
          await markSessionPresent(user.uid, session.id, capturedPhotoUrl || undefined);
        }
      } else if (stagedPersonalStatus === "absent" && session.personalStatus !== "absent") {
        if (onMarkAbsent) {
          await onMarkAbsent(session.id);
        } else {
          await markSessionAbsent(user.uid, session.id);
        }
      }

      if (stagedErpStatus && !session.erpStatus) {
        if (onRecordErp) {
          await onRecordErp(session.id, stagedErpStatus as any);
        } else {
          await recordSessionErpStatus(user.uid, session.id, stagedErpStatus as any);
        }
      }

      if (stagedNote && !session.note) {
        await updateSessionNote(user.uid, session.id, stagedNote);
      }

      setNotice("All attendance status and keynote saved successfully!");
      setTimeout(() => {
        onOpenChange(false);
      }, 700);
    } catch (err: any) {
      setError(err?.message || "Could not save status.");
    } finally {
      setBusy(false);
    }
  };

  if (!session) return null;

  const countdownText =
    secondsRemaining !== null
      ? `${Math.floor(secondsRemaining / 60)}m ${secondsRemaining % 60}s`
      : null;

  const currentStatusLabel = sessionStatusLabel(session);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto p-0 sm:rounded-2xl">
        {/* Header matching Live Class Attendance mockup */}
        <div className="border-b bg-muted/30 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex h-6 w-9 items-center justify-center rounded-md bg-primary/10 text-primary font-mono font-bold text-xs">
                  {session.slot}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {session.category} · {session.room ? `Room ${session.room}` : "SISTec Campus"}
                </span>
              </div>
              <DialogTitle className="mt-1.5 text-lg sm:text-xl font-bold tracking-tight">
                {session.subjectName}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                <span className="font-mono">{session.subjectCode}</span>
                <span>·</span>
                <span>Scheduled: {formatClock(session.scheduledStartAt)} – {formatClock(session.scheduledEndAt)} IST</span>
              </DialogDescription>
            </div>
            <div className="shrink-0">
              <StateBadge status={currentStatusLabel}>{currentStatusLabel}</StateBadge>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {notice ? (
            <Alert className="bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <AlertDescription className="font-medium">{notice}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive" className="text-xs">
              <CircleAlert className="h-4 w-4" />
              <AlertDescription className="font-medium">{error}</AlertDescription>
            </Alert>
          ) : null}

          {/* Live countdown or status alert */}
          {inWindow ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
              <div className="flex items-center justify-center gap-2 text-emerald-700 dark:text-emerald-300 font-semibold text-sm">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                Live Class Active (In Run)
              </div>
              <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                Live countdown until the window closes: <strong className="font-mono text-sm">{countdownText}</strong>
              </p>
            </div>
          ) : isToday && !session.finalized && nowMs < startMs ? (
            <div className="rounded-xl border bg-muted/40 p-3.5 text-center text-xs text-muted-foreground">
              <Clock3 className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              Upcoming class · Attendance window opens at <strong>{formatClock(session.scheduledStartAt)} IST</strong>
            </div>
          ) : null}

          {/* AttendWise Application Attendance */}
          <div className="rounded-xl border p-4 bg-card/60 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold">AttendWise Application Attendance</h4>
                  <p className="text-[11px] text-muted-foreground">Authoritative verified attendance record</p>
                </div>
              </div>
              <div>
                {stagedPersonalStatus === "present" ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs">
                    <Check className="h-3 w-3 mr-1" /> Present (Staged / Locked)
                  </Badge>
                ) : stagedPersonalStatus === "absent" ? (
                  <Badge variant="destructive" className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 text-xs">
                    <X className="h-3 w-3 mr-1" /> Marked Absent by Student (Staged)
                  </Badge>
                ) : session.personalStatus === "present" ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs">
                    <Check className="h-3 w-3 mr-1" /> Present (Locked)
                  </Badge>
                ) : session.personalStatus === "absent" || isWindowOverdue ? (
                  <Badge variant="destructive" className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 text-xs">
                    <X className="h-3 w-3 mr-1" /> {session.absentType === "manual_student" ? "Marked Absent by Student" : "Automatically Marked Absent"}
                  </Badge>
                ) : inWindow ? (
                  <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 text-xs animate-pulse">
                    In Run · Window Open
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Upcoming
                  </Badge>
                )}
              </div>
            </div>

            {/* If in active window and not yet marked */}
            {inWindow && session.personalStatus === "upcoming" ? (
              <div className="space-y-3 pt-2">
                {/* Optional live camera capture matching image */}
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5 text-primary" /> Capture Live Photo (Optional)
                    </span>
                    <span className="text-[10px] text-muted-foreground">Capture helps validate privacy</span>
                  </div>

                  {cameraActive ? (
                    <div className="space-y-2">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-44 object-cover rounded-lg border bg-black"
                      />
                      <Button size="sm" onClick={snapPhoto} className="w-full text-xs">
                        <Camera className="h-3.5 w-3.5 mr-1.5" /> Snap Photo
                      </Button>
                    </div>
                  ) : capturedPhotoUrl ? (
                    <div className="space-y-2">
                      <img
                        src={capturedPhotoUrl}
                        alt="Captured proof"
                        className="w-full h-36 object-cover rounded-lg border"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCapturedPhotoUrl(null)}
                        className="w-full text-xs"
                      >
                        Retake / Remove Photo
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={startCamera}
                      className="w-full text-xs"
                    >
                      <Camera className="h-3.5 w-3.5 mr-1.5" /> Enable Live Camera (Optional)
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button
                    className={`w-full font-semibold text-xs h-9 shadow-xs ${
                      stagedPersonalStatus === "present"
                        ? "bg-emerald-600 text-white"
                        : "bg-primary hover:bg-primary/90 text-primary-foreground"
                    }`}
                    disabled={busy}
                    onClick={handleStagePresent}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" /> {stagedPersonalStatus === "present" ? "Present (Staged)" : "Mark Present"}
                  </Button>
                  <Button
                    variant="outline"
                    className={`w-full text-xs h-9 ${
                      stagedPersonalStatus === "absent"
                        ? "bg-rose-600 text-white border-rose-600"
                        : "hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
                    }`}
                    disabled={busy}
                    onClick={handleStageAbsent}
                  >
                    <X className="h-4 w-4 mr-1.5" /> {stagedPersonalStatus === "absent" ? "Absent by Student (Staged)" : "Mark Absent"}
                  </Button>
                </div>
              </div>
            ) : session.personalStatus === "present" ? (
              <div className="rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3 text-xs space-y-2">
                <p className="font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" /> Attendance Receipt Recorded
                </p>
                <p className="text-emerald-700 dark:text-emerald-300">
                  Recorded at: <strong>{session.serverReceiptAt ? `${formatClock(session.serverReceiptAt)} IST` : "Recorded"}</strong>
                </p>
                {evidencePhotoUrl ? (
                  <div className="space-y-1 pt-1">
                    <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-200 block">Captured Proof Photo:</span>
                    <img src={evidencePhotoUrl} alt="Captured proof" className="w-full h-32 object-cover rounded-md border" />
                  </div>
                ) : null}
                <p className="text-[11px] text-muted-foreground">
                  Authoritative server receipt logged. This record is locked and cannot be edited.
                </p>
              </div>
            ) : isWindowOverdue ? (
              <div className="rounded-lg bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 p-3 text-xs space-y-1">
                <p className="font-semibold text-rose-800 dark:text-rose-200 flex items-center gap-1.5">
                  <X className="h-3.5 w-3.5" /> Attendance Window Closed
                </p>
                <p className="text-rose-700 dark:text-rose-300">
                  Class interval ({formatClock(session.scheduledStartAt)} – {formatClock(session.scheduledEndAt)} IST) elapsed. Automatically finalized as Absent on AttendWise.
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Finalized on AttendWise and uneditable.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Attendance window has not opened yet. Marking opens at {formatClock(session.scheduledStartAt)} IST.
              </p>
            )}
          </div>

          {/* College ERP Attendance Section */}
          <div className="rounded-xl border p-4 bg-muted/20 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h4 className="text-xs font-semibold flex items-center gap-1.5">
                  <TableProperties className="h-3.5 w-3.5 text-primary" />
                  Mark Attendance on ERP
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Record attendance status observed on official college ERP portal
                </p>
              </div>
              {session.erpStatus ? (
                <Badge
                  variant="outline"
                  className={
                    session.erpStatus === "Present"
                      ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 text-xs font-medium"
                      : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 text-xs font-medium"
                  }
                >
                  ERP: {session.erpStatus} (Locked)
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  ERP: Not Recorded
                </Badge>
              )}
            </div>

            {/* Note / Keynote Section (One-time save, immutable & read-only once saved) */}
            {session.note ? (
              <div className="rounded-xl border p-4 bg-muted/20 space-y-2 mb-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <BookOpen className="h-3.5 w-3.5 text-primary" />
                    Message / Keynote (Locked & Immutable)
                  </h4>
                  <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary">
                    Saved & Read-Only
                  </Badge>
                </div>
                <p className="text-xs font-semibold text-foreground bg-card p-2.5 rounded border">
                  &quot;{session.note}&quot;
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Keynote is permanently bounded to this class record and cannot be altered.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border p-4 bg-muted/20 space-y-2.5 mb-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5 text-primary" />
                    Message / Keynote (Optional)
                  </h4>
                  <span className="text-[10px] text-muted-foreground">e.g., Expert lecture in EC Audi</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Add a note or excuse regarding class timings or unexpected changes. Once saved, it becomes permanent, immutable, and uneditable.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    placeholder="Write keynote / note here..."
                    className="text-xs h-8"
                    disabled={busy}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-8 shrink-0"
                    disabled={busy || !noteInput.trim()}
                    onClick={handleStageNote}
                  >
                    Stage Keynote
                  </Button>
                </div>
              </div>
            )}

            {/* Freeze Class Option */}
            {session.personalStatus === "frozen" ? (
              <div className="rounded-xl border p-4 bg-rose-500/10 border-rose-500/20 text-rose-800 dark:text-rose-300 text-xs font-semibold text-center flex items-center justify-center gap-2">
                <XCircle className="h-4 w-4" /> Class Frozen and Excluded from Attendance
              </div>
            ) : (
              <div className="rounded-xl border p-4 bg-rose-50/50 border-rose-100 dark:bg-rose-950/20 dark:border-rose-900/50 space-y-2">
                <h4 className="text-xs font-semibold text-rose-800 dark:text-rose-300">
                  ⚠️ Advanced Actions
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Freezing this class will remove it entirely from all attendance calculations and percentages. This action is <strong>permanent and immutable</strong>.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs text-rose-700 border-rose-200 hover:bg-rose-100 dark:text-rose-400 dark:border-rose-800"
                  onClick={async () => {
                    if (window.confirm("Are you sure you want to PERMANENTLY FREEZE this class? This action cannot be undone.")) {
                      setBusy(true);
                      try {
                        await freezeClassSession(user.uid, session.id);
                        setNotice("Class successfully frozen and removed from calculations.");
                        // Keep open briefly so user sees the change
                        setTimeout(() => onOpenChange(false), 1500);
                      } catch (err: any) {
                        setError(err?.message || "Could not freeze class.");
                      } finally {
                        setBusy(false);
                      }
                    }
                  }}
                  disabled={busy}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" /> Permanently Freeze Class
                </Button>
              </div>
            )}

            {/* ERP uneditable check (Available always for one time only) */}
            {session.personalStatus !== "frozen" && (session.erpStatus !== null && session.erpStatus !== undefined) ? (
              <div className="rounded-lg bg-card p-3 border text-xs">
                {/* ... existing ERP finalized ... */}
              </div>
            ) : session.personalStatus !== "frozen" ? (
              <div className="space-y-2 pt-1">
                 {/* ... existing ERP buttons ... */}
              </div>
            ) : null}
          </div>

          {/* Attendance Details Table & Event Timeline */}
          <div className="rounded-xl border p-4 bg-card/60 space-y-3">
            <h4 className="text-xs font-semibold text-foreground">Attendance Details & Audit Log</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg bg-muted/40 p-2.5">
                <span className="text-muted-foreground block text-[10px] uppercase font-medium">Subject</span>
                <span className="font-semibold truncate block mt-0.5">{session.subjectName}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{session.subjectCode}</span>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5">
                <span className="text-muted-foreground block text-[10px] uppercase font-medium">Date</span>
                <span className="font-semibold block mt-0.5">{formatDate(session.scheduledDate)}</span>
                <span className="text-[10px] text-muted-foreground">Day {session.academicDayNumber || "—"}</span>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5">
                <span className="text-muted-foreground block text-[10px] uppercase font-medium">Time Interval</span>
                <span className="font-semibold block mt-0.5">{formatClock(session.scheduledStartAt)} – {formatClock(session.scheduledEndAt)}</span>
                <span className="text-[10px] text-muted-foreground">{session.slot}</span>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5">
                <span className="text-muted-foreground block text-[10px] uppercase font-medium">Personal (AttendWise)</span>
                <span className="font-semibold block mt-0.5 capitalize">{session.personalStatus}</span>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5">
                <span className="text-muted-foreground block text-[10px] uppercase font-medium">ERP Status</span>
                <span className="font-semibold block mt-0.5">{session.erpStatus ?? "Not Entered"}</span>
              </div>
              <div className="rounded-lg bg-muted/40 p-2.5">
                <span className="text-muted-foreground block text-[10px] uppercase font-medium">Finalization</span>
                <span className="font-semibold block mt-0.5">{session.finalized ? "Finalized" : "Pending"}</span>
              </div>
            </div>

            {/* Event Timeline */}
            <div className="pt-2 border-t">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                Event Timeline
              </span>
              {events.length ? (
                <ol className="space-y-2.5">
                  {events.map((ev) => (
                    <li key={ev.id} className="flex items-start gap-2 text-xs">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                        <Check className="h-3 w-3" />
                      </span>
                      <div>
                        <p className="font-medium text-foreground">{ev.message}</p>
                        <p className="text-[10px] text-muted-foreground">{formatDateTime(ev.serverTimestamp)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Scheduled time: {formatDateTime(session.scheduledStartAt)}
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="p-4 sm:p-5 border-t bg-muted/20 flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Close
          </Button>
          <Button
            size="sm"
            className="text-xs font-semibold bg-primary text-primary-foreground shadow-xs gap-1.5"
            disabled={busy}
            onClick={handleSaveAllStatus}
          >
            <Check className="h-4 w-4" /> Save Status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Main Dashboard with Today's Schedule and embedded Attendance History Dashboard
function Dashboard({
  user,
  profile,
  sessions,
  subjects,
  onRecordErp,
  onMarkPresent,
  onMarkAbsent,
}: {
  user: FirebaseUser;
  profile?: StudentProfile | null;
  sessions: ClassSessionItem[];
  subjects?: SubjectItem[];
  onRecordErp?: (sessionId: string, status: "Present" | "Absent") => Promise<void>;
  onMarkPresent?: (sessionId: string, photoUrl?: string) => Promise<void>;
  onMarkAbsent?: (sessionId: string) => Promise<void>;
}) {
  const [selectedCardSession, setSelectedCardSession] = useState<ClassSessionItem | null>(null);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Filters for the Attendance History dashboard embedded on the page
  const [filters, setFilters] = useState({
    subjectId: "",
    category: "",
    personalStatus: "",
    comparisonStatus: "",
    from: "",
    to: "",
  });

  const patchFilter = (k: string, v: string) => setFilters((prev) => ({ ...prev, [k]: v }));
  const resetFilters = () =>
    setFilters({
      subjectId: "",
      category: "",
      personalStatus: "",
      comparisonStatus: "",
      from: "",
      to: "",
    });

  const stats = useMemo(() => computeAttendanceStats(sessions), [sessions]);

  // Today's classes
  const todayKey = formatDateKey(new Date());
  const todaySessions = useMemo(
    () =>
      sessions
        .filter((s) => s.scheduledDate === todayKey)
        .sort((a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime()),
    [sessions, todayKey]
  );

  const [currentTick, setCurrentTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const nowMs = currentTick;

  const todayCalendarInfo = useMemo(() => getCalendarDayInfo(todayKey), [todayKey]);
  const nextHoliday = useMemo(() => {
    return SISTEC_OFFICIAL_HOLIDAYS.find((h) => h.startDate >= todayKey);
  }, [todayKey]);

  // Filtered sessions for Attendance History Dashboard
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (filters.subjectId && s.subjectId !== filters.subjectId) return false;
      if (filters.category && s.category !== filters.category) return false;
      if (filters.personalStatus) {
        if (filters.personalStatus === "in_run") {
          if (!isSessionInWindow(s, nowMs)) return false;
        } else if (filters.personalStatus === "upcoming") {
          if (s.personalStatus !== "upcoming" || isSessionInWindow(s, nowMs)) return false;
        } else if (s.personalStatus !== filters.personalStatus) {
          return false;
        }
      }
      if (filters.from && s.scheduledDate < filters.from) return false;
      if (filters.to && s.scheduledDate > filters.to) return false;
      if (filters.comparisonStatus) {
        if (filters.comparisonStatus === "erp_not_entered" && s.erpStatus !== null) return false;
        if (filters.comparisonStatus === "match") {
          const personal = s.personalStatus === "present" ? "Present" : "Absent";
          if (s.erpStatus !== personal) return false;
        }
        if (filters.comparisonStatus === "potential_discrepancy") {
          const personal = s.personalStatus === "present" ? "Present" : "Absent";
          if (!s.erpStatus || s.erpStatus === personal) return false;
        }
      }
      return true;
    }).sort((a, b) => new Date(b.scheduledStartAt).getTime() - new Date(a.scheduledStartAt).getTime());
  }, [sessions, filters, nowMs]);

  const handleOpenAttendanceCard = (session: ClassSessionItem) => {
    setSelectedCardSession(session);
    setCardDialogOpen(true);
  };

  return (
    <>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Good day, {profile?.displayName?.split(" ")[0] || "Student"}.
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your SISTec college attendance and class session dashboard.
          </p>
        </div>
        <div className="flex items-center gap-2.5 self-start sm:self-auto flex-wrap">
          <LiveServerClock />
          <Badge variant="outline" className="bg-muted/40 font-mono text-xs h-9">
            <Sparkles className="mr-1 h-3 w-3 text-primary" /> SISTec AIDS 3 Sem
          </Badge>
        </div>
      </div>

      {actionNotice ? (
        <Alert className="mb-4 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription className="text-xs font-medium">{actionNotice}</AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive" className="mb-4">
          <CircleAlert className="h-4 w-4" />
          <AlertDescription className="text-xs font-medium">{actionError}</AlertDescription>
        </Alert>
      ) : null}

      {/* SISTec GN Academic Calendar Banner */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5 rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CalendarRange className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold">SISTec Academic Calendar</span>
              {todayCalendarInfo.type === "teaching" ? (
                <Badge className="bg-primary text-primary-foreground text-[10px] font-semibold">
                  Instructional Day {todayCalendarInfo.dayNumber} of 57
                </Badge>
              ) : todayCalendarInfo.type === "holiday" ? (
                <Badge variant="destructive" className="text-[10px] font-semibold">
                  Holiday: {todayCalendarInfo.title}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  {todayCalendarInfo.title}
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {todayCalendarInfo.type === "teaching"
                ? "Official teaching day · Scheduled classes count towards your personal attendance record."
                : "No classes scheduled today · Official holidays do not count in attendance totals."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {nextHoliday ? (
            <span className="text-[11px] text-muted-foreground hidden lg:inline">
              Upcoming: <strong className="text-destructive font-medium">{nextHoliday.name}</strong> ({nextHoliday.startDate})
            </span>
          ) : null}
          <Link
            href="/calendar"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/60 px-3 py-1.5 text-xs font-medium hover:bg-muted text-foreground"
          >
            Full Academic Calendar <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Today's Schedule with direct Attendance Card entry */}
      <Card className="mb-6 shadow-xs border-primary/20">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" /> Today&apos;s Schedule
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Intl.DateTimeFormat("en-IN", {
                timeZone: TIMEZONE,
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(new Date())}{" "}
              · Enter attendance card for today&apos;s lectures below
            </p>
          </div>
          <Link
            href="/timetable"
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
          >
            Timetable <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent>
          {todaySessions.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {todaySessions.map((session) => {
                const startMs = new Date(session.scheduledStartAt).getTime();
                const endMs = new Date(session.scheduledEndAt).getTime();
                const inWindow = !session.finalized && nowMs >= startMs && nowMs < endMs;
                const isWindowOverdue = nowMs >= endMs || session.personalStatus === "absent";
                const statusLabel = sessionStatusLabel(session);

                return (
                  <div
                    key={session.id}
                    className={`rounded-xl border p-4 transition-all hover:border-primary/50 bg-card flex flex-col justify-between gap-3 shadow-xs ${
                      inWindow ? "border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/20" : ""
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex h-6 w-8 items-center justify-center rounded-md bg-primary/10 text-primary font-mono font-bold text-xs">
                          {session.slot}
                        </span>
                        <StateBadge status={statusLabel}>{statusLabel}</StateBadge>
                      </div>

                      <h4 className="mt-2 font-semibold text-sm line-clamp-1">{session.subjectName}</h4>
                      <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                        {session.subjectCode} · {session.category} {session.room ? `· Room ${session.room}` : ""}
                      </p>

                      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                        <Clock3 className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span>{formatClock(session.scheduledStartAt)} – {formatClock(session.scheduledEndAt)} IST</span>
                      </div>

                      <div className="mt-2 pt-2 border-t flex items-center justify-between gap-2 text-xs">
                        <span className="text-[11px] text-muted-foreground">ERP Status:</span>
                        {session.erpStatus ? (
                          <Badge
                            variant="outline"
                            className={
                              session.erpStatus === "Present"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-medium"
                                : "bg-rose-50 text-rose-700 border-rose-200 text-[10px] font-medium"
                            }
                          >
                            ERP: {session.erpStatus} (Locked)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            ERP: Not Recorded
                          </Badge>
                        )}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      className="w-full text-xs font-semibold h-8 shadow-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground"
                      onClick={() => handleOpenAttendanceCard(session)}
                    >
                      <TableProperties className="h-3.5 w-3.5" /> Enter Attendance Card
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No classes scheduled today"
              detail="Today has no timetable entries scheduled. Enjoy your academic self-study time."
              action={
                <Link href="/timetable" className="text-xs font-semibold text-primary hover:underline">
                  Open full timetable
                </Link>
              }
            />
          )}
        </CardContent>
      </Card>

      {/* Attendance History Dashboard (replaced the analytics section as requested) */}
      <Card className="shadow-xs">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Attendance History Dashboard
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              All sessions with real-time In Run, Upcoming, and Finalized attendance states.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-foreground">
              {filteredSessions.length} Session{filteredSessions.length === 1 ? "" : "s"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter Bar */}
          <div className="grid gap-2.5 p-3.5 rounded-xl bg-muted/40 border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 text-xs">
            <div className="space-y-1">
              <Label htmlFor="dh-sub" className="text-xs">Subject</Label>
              <Select value={filters.subjectId || "all"} onValueChange={(v) => patchFilter("subjectId", v === "all" ? "" : v)}>
                <SelectTrigger id="dh-sub" className="h-8 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Subjects</SelectItem>
                  {subjects?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="dh-cat" className="text-xs">Category</Label>
              <Select value={filters.category || "all"} onValueChange={(v) => patchFilter("category", v === "all" ? "" : v)}>
                <SelectTrigger id="dh-cat" className="h-8 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  <SelectItem value="Theory">Theory</SelectItem>
                  <SelectItem value="Practical">Practical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="dh-status" className="text-xs">Status</Label>
              <Select
                value={filters.personalStatus || "all"}
                onValueChange={(v) => patchFilter("personalStatus", v === "all" ? "" : v)}
              >
                <SelectTrigger id="dh-status" className="h-8 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="in_run">In Run (Active Window)</SelectItem>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="present">Present</SelectItem>
                  <SelectItem value="absent">Absent</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="dh-comp" className="text-xs">ERP Comparison</Label>
              <Select
                value={filters.comparisonStatus || "all"}
                onValueChange={(v) => patchFilter("comparisonStatus", v === "all" ? "" : v)}
              >
                <SelectTrigger id="dh-comp" className="h-8 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Comparisons</SelectItem>
                  <SelectItem value="match">Match</SelectItem>
                  <SelectItem value="potential_discrepancy">Potential Discrepancy</SelectItem>
                  <SelectItem value="erp_not_entered">ERP Not Entered</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="dh-from" className="text-xs">From Date</Label>
              <Input
                id="dh-from"
                type="date"
                className="h-8 text-xs bg-background"
                value={filters.from}
                onChange={(e) => patchFilter("from", e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="dh-to" className="text-xs">To Date</Label>
              <div className="flex gap-1.5">
                <Input
                  id="dh-to"
                  type="date"
                  className="h-8 text-xs bg-background"
                  value={filters.to}
                  onChange={(e) => patchFilter("to", e.target.value)}
                />
                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={resetFilters} aria-label="Clear filters">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Session Cards Listing */}
          {filteredSessions.length ? (
            <div className="divide-y rounded-xl border">
              {filteredSessions.map((session) => {
                const statusLabel = sessionStatusLabel(session);
                const isTodaySession = session.scheduledDate === todayKey;

                return (
                  <div
                    key={session.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="flex h-5 w-7 items-center justify-center rounded bg-primary/10 text-primary font-mono font-bold text-[11px]">
                          {session.slot}
                        </span>
                        <p className="font-semibold text-sm truncate">{session.subjectName}</p>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {session.subjectCode}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {session.category}
                        </Badge>
                        {session.academicDayNumber ? (
                          <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                            Day {session.academicDayNumber}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span>{formatDate(session.scheduledDate)}</span>
                        <span>·</span>
                        <span>{formatClock(session.scheduledStartAt)} – {formatClock(session.scheduledEndAt)} IST</span>
                        {session.room ? <span>· Room: {session.room}</span> : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                      <StateBadge status={statusLabel}>{statusLabel}</StateBadge>

                      {session.erpStatus ? (
                        <Badge
                          variant="outline"
                          className={
                            session.erpStatus === "Present"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-medium"
                              : "bg-rose-50 text-rose-700 border-rose-200 text-[10px] font-medium"
                          }
                        >
                          ERP: {session.erpStatus} (Locked)
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">ERP Not Entered</span>
                      )}

                      <Button
                        size="sm"
                        variant={isTodaySession ? "default" : "outline"}
                        className={`text-xs h-7 gap-1 shadow-xs font-medium ${
                          isTodaySession ? "bg-primary hover:bg-primary/90 text-primary-foreground" : ""
                        }`}
                        onClick={() => handleOpenAttendanceCard(session)}
                      >
                        <TableProperties className="h-3 w-3" />
                        {isTodaySession ? "Enter Attendance Card" : "View Card"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No class records match these filters"
              detail="No scheduled classes found matching your current filter criteria."
              action={
                <Button variant="outline" onClick={resetFilters} size="sm">
                  Clear filters
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>

      {/* Interactive Attendance Card Modal */}
      <AttendanceCardDialog
        open={cardDialogOpen}
        onOpenChange={setCardDialogOpen}
        session={selectedCardSession}
        user={user}
        onRecordErp={onRecordErp}
        onMarkPresent={onMarkPresent}
        onMarkAbsent={onMarkAbsent}
      />
    </>
  );
}

// Timetable View
function Timetable({
  user,
  timetable,
  subjects,
}: {
  user: FirebaseUser;
  timetable: TimetableItem[];
  subjects: SubjectItem[];
}) {
  const [day, setDay] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TimetableItem | null>(null);
  const [error, setError] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [category, setCategory] = useState<"Theory" | "Practical">("Theory");
  const [startTime, setStartTime] = useState("09:35");
  const [endTime, setEndTime] = useState("10:35");
  const [slot, setSlot] = useState("P1");
  const [room, setRoom] = useState("");
  const [entryDay, setEntryDay] = useState(1);
  const [busy, setBusy] = useState(false);

  const dayEntries = useMemo(
    () =>
      timetable
        .filter((entry) => entry.dayOfWeek === day && entry.active)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [timetable, day]
  );

  const openForm = (entry?: TimetableItem) => {
    setEditing(entry ?? null);
    setEntryDay(entry?.dayOfWeek ?? day);
    setSubjectId(entry?.subjectId ?? subjects[0]?.id ?? "");
    setCategory(entry?.category ?? "Theory");
    setStartTime(entry?.startTime ?? "09:35");
    setEndTime(entry?.endTime ?? "10:35");
    setSlot(entry?.slot ?? "P1");
    setRoom(entry?.room ?? "");
    setError("");
    setDialogOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!subjectId) {
      setError("Please choose a subject.");
      return;
    }
    if (startTime >= endTime) {
      setError("End time must be later than start time.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const selectedSub = subjects.find((s) => s.id === subjectId);
      const data = {
        subjectId,
        subjectName: selectedSub?.name || "Subject",
        subjectCode: selectedSub?.code || "CODE",
        slot,
        dayOfWeek: entryDay,
        startTime,
        endTime,
        category,
        room: room || null,
        updatedAt: new Date().toISOString(),
      };

      if (editing) {
        const ref = doc(db, "users", user.uid, "timetableEntries", editing.id);
        await updateDoc(ref, data);
      } else {
        const newRef = doc(collection(db, "users", user.uid, "timetableEntries"));
        await setDoc(newRef, {
          ...data,
          id: newRef.id,
          studentId: user.uid,
          active: true,
          sourceId: "manual-entry",
          createdAt: new Date().toISOString(),
        });
      }
      setDialogOpen(false);
    } catch (err: any) {
      setError(err?.message || "Could not save timetable entry.");
    } finally {
      setBusy(false);
    }
  };

  const removeEntry = async (entry: TimetableItem) => {
    if (window.confirm(`Remove ${entry.subjectName} (${entry.slot}) from recurring timetable?`)) {
      try {
        await deleteDoc(doc(db, "users", user.uid, "timetableEntries", entry.id));
      } catch (err: any) {
        setError(err?.message || "Could not delete class entry.");
      }
    }
  };

  return (
    <>
      <PageHeading
        title="Weekly Timetable"
        description="SISTec AIDS 3rd Semester weekly recurring schedule (Asia/Kolkata IST)."
        action={
          <Button onClick={() => openForm()} data-testid="button-add-class" size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Class
          </Button>
        }
      />

      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-primary shrink-0" />
          <span>Timetable slots only execute on approved teaching days per the SISTec Academic Calendar. Holidays and non-working days have 0 classes.</span>
        </div>
        <Link href="/calendar" className="text-primary font-medium hover:underline shrink-0 flex items-center gap-1">
          Open Academic Calendar <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="mb-5 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Select day">
        {WEEK_DAYS.map((name, index) => (
          <Button
            key={name}
            role="tab"
            aria-selected={day === index + 1}
            variant={day === index + 1 ? "default" : "outline"}
            size="sm"
            onClick={() => setDay(index + 1)}
            data-testid={`tab-day-${name.toLowerCase()}`}
          >
            {name}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>{WEEK_DAYS[day - 1]} Schedule</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              6 Slots (P1 to P6) · Lunch Break 1:35 PM – 2:10 PM
            </p>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {dayEntries.length} Slots
          </Badge>
        </CardHeader>
        <CardContent>
          {dayEntries.length ? (
            <div className="space-y-3">
              {dayEntries.map((entry) => (
                <article
                  key={entry.id}
                  className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center"
                  data-testid={`card-timetable-${entry.id}`}
                >
                  <div className="flex min-w-44 items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-mono font-bold text-xs">
                      {entry.slot}
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{formatClock(entry.startTime)}</p>
                      <p className="text-xs text-muted-foreground">to {formatClock(entry.endTime)}</p>
                    </div>
                  </div>

                  <Separator orientation="vertical" className="hidden h-10 sm:block" />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{entry.subjectName}</p>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {entry.subjectCode}
                      </Badge>
                      {entry.subjectName.includes("/ Sa") || entry.subjectName.includes("Computer Workshop/I") ? (
                        <span className="text-[10px] text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-900">
                          PDF abbreviation
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <Badge
                        variant="outline"
                        className={entry.category === "Practical" ? "bg-secondary/15 text-secondary border-secondary/30" : ""}
                      >
                        {entry.category}
                      </Badge>
                      {entry.room ? <span className="text-muted-foreground">· {entry.room}</span> : null}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => openForm(entry)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeEntry(entry)}>
                      Remove
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No classes scheduled"
              detail="No classes are currently scheduled for this day in your timetable."
              action={
                <Button variant="outline" onClick={() => openForm()} size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Add Class
                </Button>
              }
            />
          )}
          {error && !dialogOpen ? (
            <Alert variant="destructive" className="mt-4">
              <CircleAlert className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Full week grid">
        {WEEK_DAYS.map((name, index) => {
          const slots = timetable
            .filter((entry) => entry.dayOfWeek === index + 1 && entry.active)
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
          return (
            <Card key={name} className={day === index + 1 ? "border-primary" : ""}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-semibold">{name}</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setDay(index + 1)} className="text-xs h-7">
                  Focus
                </Button>
              </CardHeader>
              <CardContent className="space-y-1.5 text-xs">
                {slots.length ? (
                  slots.map((entry) => (
                    <div key={entry.id} className="rounded-md border-l-2 border-primary bg-muted/30 px-2.5 py-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-medium truncate">{entry.subjectCode}</span>
                        <span className="text-[10px] text-muted-foreground">{entry.slot}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{entry.subjectName}</p>
                    </div>
                  ))
                ) : (
                  <p className="py-2 text-muted-foreground text-center">No classes</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Timetable Class" : "Add Timetable Class"}</DialogTitle>
            <DialogDescription>
              Update your recurring college schedule. Changes sync automatically to Firebase.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="class-sub">Subject</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger id="class-sub">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code} — {s.name} ({s.category})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="class-day">Day</Label>
                <Select value={String(entryDay)} onValueChange={(v) => setEntryDay(Number(v))}>
                  <SelectTrigger id="class-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEK_DAYS.map((name, i) => (
                      <SelectItem key={name} value={String(i + 1)}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="class-slot">Slot</Label>
                <Select value={slot} onValueChange={setSlot}>
                  <SelectTrigger id="class-slot">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SISTEC_TIME_SLOTS.map((s) => (
                      <SelectItem key={s.slot} value={s.slot}>
                        {s.slot} ({s.start} - {s.end})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="class-start">Start Time (IST)</Label>
                <Input
                  id="class-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="class-end">End Time (IST)</Label>
                <Input
                  id="class-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="class-cat">Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as any)}>
                  <SelectTrigger id="class-cat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Theory">Theory</SelectItem>
                    <SelectItem value="Practical">Practical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="class-room">Room / Lab (optional)</Label>
                <Input
                  id="class-room"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  placeholder="e.g. Lab 3 / B-204"
                />
              </div>
            </div>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : editing ? "Save Changes" : "Add to Timetable"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Attendance History View
function AttendanceHistory({
  user,
  sessions,
  subjects,
  onRecordErp,
  onMarkPresent,
  onMarkAbsent,
}: {
  user?: FirebaseUser | null;
  sessions: ClassSessionItem[];
  subjects: SubjectItem[];
  onRecordErp?: (sessionId: string, status: "Present" | "Absent") => Promise<void>;
  onMarkPresent?: (sessionId: string, photoUrl?: string) => Promise<void>;
  onMarkAbsent?: (sessionId: string) => Promise<void>;
}) {
  const [selectedSession, setSelectedSession] = useState<ClassSessionItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [filters, setFilters] = useState({
    subjectId: "",
    category: "",
    personalStatus: "",
    comparisonStatus: "",
    from: "",
    to: "",
  });

  const patch = (k: string, v: string) => setFilters((prev) => ({ ...prev, [k]: v }));
  const reset = () =>
    setFilters({
      subjectId: "",
      category: "",
      personalStatus: "",
      comparisonStatus: "",
      from: "",
      to: "",
    });

  const [currentTick, setCurrentTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const nowMs = currentTick;
  const todayKey = formatDateKey(new Date());

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (filters.subjectId && s.subjectId !== filters.subjectId) return false;
      if (filters.category && s.category !== filters.category) return false;
      if (filters.personalStatus) {
        if (filters.personalStatus === "in_run") {
          if (!isSessionInWindow(s, nowMs)) return false;
        } else if (filters.personalStatus === "upcoming") {
          if (s.personalStatus !== "upcoming" || isSessionInWindow(s, nowMs)) return false;
        } else if (s.personalStatus !== filters.personalStatus) {
          return false;
        }
      }
      if (filters.from && s.scheduledDate < filters.from) return false;
      if (filters.to && s.scheduledDate > filters.to) return false;
      if (filters.comparisonStatus) {
        if (filters.comparisonStatus === "erp_not_entered" && s.erpStatus !== null) return false;
        if (filters.comparisonStatus === "match") {
          const personal = s.personalStatus === "present" ? "Present" : "Absent";
          if (s.erpStatus !== personal) return false;
        }
        if (filters.comparisonStatus === "potential_discrepancy") {
          const personal = s.personalStatus === "present" ? "Present" : "Absent";
          if (!s.erpStatus || s.erpStatus === personal) return false;
        }
      }
      return true;
    }).sort((a, b) => new Date(b.scheduledStartAt).getTime() - new Date(a.scheduledStartAt).getTime());
  }, [sessions, filters, nowMs]);

  return (
    <>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Attendance History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Authentic attendance records logged in Firebase. Track active and past classes.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <LiveServerClock />
        </div>
      </div>

      <Card className="mb-5">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 text-xs">
          <div className="space-y-1">
            <Label htmlFor="f-sub" className="text-xs">Subject</Label>
            <Select value={filters.subjectId || "all"} onValueChange={(v) => patch("subjectId", v === "all" ? "" : v)}>
              <SelectTrigger id="f-sub">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subjects</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="f-cat" className="text-xs">Category</Label>
            <Select value={filters.category || "all"} onValueChange={(v) => patch("category", v === "all" ? "" : v)}>
              <SelectTrigger id="f-cat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                <SelectItem value="Theory">Theory</SelectItem>
                <SelectItem value="Practical">Practical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="f-status" className="text-xs">Personal Status</Label>
            <Select
              value={filters.personalStatus || "all"}
              onValueChange={(v) => patch("personalStatus", v === "all" ? "" : v)}
            >
              <SelectTrigger id="f-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="in_run">In Run (Active Window)</SelectItem>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="f-comp" className="text-xs">ERP Comparison</Label>
            <Select
              value={filters.comparisonStatus || "all"}
              onValueChange={(v) => patch("comparisonStatus", v === "all" ? "" : v)}
            >
              <SelectTrigger id="f-comp">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Comparisons</SelectItem>
                <SelectItem value="match">Match</SelectItem>
                <SelectItem value="potential_discrepancy">Potential Discrepancy</SelectItem>
                <SelectItem value="erp_not_entered">ERP Not Entered</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="f-from" className="text-xs">From Date</Label>
            <Input id="f-from" type="date" value={filters.from} onChange={(e) => patch("from", e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="f-to" className="text-xs">To Date</Label>
            <div className="flex gap-2">
              <Input id="f-to" type="date" value={filters.to} onChange={(e) => patch("to", e.target.value)} />
              <Button variant="outline" size="icon" onClick={reset} aria-label="Clear filters">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {filteredSessions.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              {filteredSessions.length} Class Session{filteredSessions.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {filteredSessions.map((session) => {
                const statusLabel = sessionStatusLabel(session);
                const isToday = session.scheduledDate === todayKey;

                return (
                  <div
                    key={session.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="flex h-5 w-7 items-center justify-center rounded bg-primary/10 text-primary font-mono font-bold text-[11px]">
                          {session.slot}
                        </span>
                        <p className="font-semibold text-sm truncate">{session.subjectName}</p>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {session.subjectCode}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {session.category}
                        </Badge>
                        {session.academicDayNumber ? (
                          <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                            Day {session.academicDayNumber}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span>{formatDate(session.scheduledDate)}</span>
                        <span>·</span>
                        <span>{formatClock(session.scheduledStartAt)} – {formatClock(session.scheduledEndAt)} IST</span>
                        {session.room ? <span>· Room: {session.room}</span> : null}
                      </div>
                      {session.note ? (
                        <p className="mt-1.5 text-xs text-primary font-medium bg-primary/5 px-2 py-1 rounded border border-primary/20 inline-block">
                          💬 Keynote: {session.note}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                      <StateBadge status={statusLabel}>{statusLabel}</StateBadge>

                      {session.erpStatus ? (
                        <Badge
                          variant="outline"
                          className={
                            session.erpStatus === "Present"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-medium"
                              : "bg-rose-50 text-rose-700 border-rose-200 text-[10px] font-medium"
                          }
                        >
                          ERP: {session.erpStatus} (Locked)
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">ERP Not Recorded</span>
                      )}

                      <Button
                        size="sm"
                        variant={isToday ? "default" : "outline"}
                        className={`text-xs h-7 gap-1 shadow-xs font-medium ${
                          isToday ? "bg-primary hover:bg-primary/90 text-primary-foreground" : ""
                        }`}
                        onClick={() => {
                          setSelectedSession(session);
                          setDialogOpen(true);
                        }}
                      >
                        <TableProperties className="h-3 w-3" />
                        {isToday ? "Enter Attendance Card" : "View Card"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title="No class records match these filters"
          detail="All seeded dummy history has been removed. Genuine sessions will accumulate as classes occur."
          action={
            <Button variant="outline" onClick={reset} size="sm">
              Clear filters
            </Button>
          }
        />
      )}

      {user ? (
        <AttendanceCardDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          session={selectedSession}
          user={user}
          onRecordErp={onRecordErp}
          onMarkPresent={onMarkPresent}
          onMarkAbsent={onMarkAbsent}
        />
      ) : null}
    </>
  );
}

// Subjects View
function Subjects({
  user,
  subjects,
  sessions,
}: {
  user: FirebaseUser;
  subjects: SubjectItem[];
  sessions: ClassSessionItem[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SubjectItem | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState<"Theory" | "Practical">("Theory");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const startEdit = (s?: SubjectItem) => {
    setEditing(s ?? null);
    setName(s?.name ?? "");
    setCode(s?.code ?? "");
    setCategory(s?.category ?? "Theory");
    setError("");
    setOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter a subject name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = {
        name: name.trim(),
        code: code.trim().toUpperCase() || "SUB",
        category,
        updatedAt: new Date().toISOString(),
      };
      if (editing) {
        await updateDoc(doc(db, "users", user.uid, "subjects", editing.id), data);
      } else {
        const newRef = doc(collection(db, "users", user.uid, "subjects"));
        await setDoc(newRef, {
          ...data,
          id: newRef.id,
          studentId: user.uid,
          iconKey: "book",
          createdAt: new Date().toISOString(),
        });
      }
      setOpen(false);
    } catch (err: any) {
      setError(err?.message || "Could not save subject.");
    } finally {
      setBusy(false);
    }
  };

  const removeSubject = async (sub: SubjectItem) => {
    if (window.confirm(`Delete ${sub.name}?`)) {
      try {
        await deleteDoc(doc(db, "users", user.uid, "subjects", sub.id));
      } catch (err: any) {
        setError(err?.message || "Could not delete subject.");
      }
    }
  };

  return (
    <>
      <PageHeading
        title="College Subjects"
        description="Official SISTec AIDS 3rd Semester subjects. Attendance is calculated from finalized sessions."
        action={
          <Button onClick={() => startEdit()} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Subject
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {subjects.map((sub) => {
          const subSessions = sessions.filter(
            (s) => s.subjectId === sub.id && s.finalized && (s.personalStatus === "present" || s.personalStatus === "absent")
          );
          const present = subSessions.filter((s) => s.personalStatus === "present").length;
          const total = subSessions.length;
          const pct = total === 0 ? null : Math.round((present / total) * 100);

          return (
            <Card key={sub.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-semibold text-base">{sub.name}</h2>
                      <Badge variant="outline" className="font-mono text-xs">
                        {sub.code}
                      </Badge>
                      {sub.reviewNeeded ? (
                        <span className="text-[10px] text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded border border-amber-200">
                          PDF abbreviation
                        </span>
                      ) : null}
                    </div>
                    <Badge
                      variant="outline"
                      className={`mt-1.5 text-xs ${
                        sub.category === "Practical" ? "bg-secondary/10 text-secondary" : ""
                      }`}
                    >
                      {sub.category}
                    </Badge>
                  </div>
                  <span className="text-2xl font-bold">{asPct(pct)}</span>
                </div>

                <div className="mt-4">
                  {pct !== null ? (
                    <Progress value={pct} aria-label={`${sub.name} attendance`} />
                  ) : (
                    <p className="text-xs text-muted-foreground">No finalized sessions yet</p>
                  )}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <p className="font-semibold">{present}</p>
                      <p className="text-muted-foreground">Present</p>
                    </div>
                    <div>
                      <p className="font-semibold">{total - present}</p>
                      <p className="text-muted-foreground">Absent</p>
                    </div>
                    <div>
                      <p className="font-semibold">{total}</p>
                      <p className="text-muted-foreground">Finalized Total</p>
                    </div>
                  </div>
                </div>

                <Separator className="my-4" />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => startEdit(sub)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => removeSubject(sub)}>
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Subject" : "Add Subject"}</DialogTitle>
            <DialogDescription>Manage subject naming and classification.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sub-name">Subject Name</Label>
              <Input
                id="sub-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Operating Systems"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sub-code">Subject Code</Label>
                <Input
                  id="sub-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. AD-304"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sub-cat">Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as any)}>
                  <SelectTrigger id="sub-cat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Theory">Theory</SelectItem>
                    <SelectItem value="Practical">Practical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save Subject"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ERP Comparison View (Read-only comparison; marking is done exclusively from the Attendance Card)
function Comparison({
  user,
  sessions,
}: {
  user: FirebaseUser;
  sessions: ClassSessionItem[];
  onRecordErp?: (sessionId: string, status: "Present" | "Absent") => Promise<void>;
}) {
  const [selectedSession, setSelectedSession] = useState<ClassSessionItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const stats = useMemo(() => computeAttendanceStats(sessions), [sessions]);

  // Eligible finalized sessions
  const eligibleSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.finalized && (s.personalStatus === "present" || s.personalStatus === "absent"))
        .sort((a, b) => new Date(b.scheduledStartAt).getTime() - new Date(a.scheduledStartAt).getTime()),
    [sessions]
  );

  return (
    <>
      <PageHeading
        title="ERP Comparison"
        description="Compare your personal AttendWise record with what you manually observe in your college ERP."
      />

      <Alert className="mb-5 bg-muted/40">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <AlertTitle className="text-xs font-semibold">Attendance Card Exclusivity</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">
          ERP attendance marking must be performed exclusively from the Attendance Card on the Dashboard for today&apos;s scheduled lectures. Once entered, ERP records are permanent and uneditable.
        </AlertDescription>
      </Alert>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Matches</p>
            <p className="mt-1 text-3xl font-bold">{stats.matchCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Potential Discrepancies</p>
            <p className="mt-1 text-3xl font-bold text-chart-4">{stats.discrepancyCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">ERP Not Entered</p>
            <p className="mt-1 text-3xl font-bold text-muted-foreground">{stats.erpNotEnteredCount}</p>
          </CardContent>
        </Card>
      </div>

      {eligibleSessions.length ? (
        <div className="space-y-3">
          {eligibleSessions.map((session) => {
            const personal = session.personalStatus === "present" ? "Present" : "Absent";
            const comparisonStatus =
              session.erpStatus === null
                ? "erp_not_entered"
                : session.erpStatus === personal
                ? "match"
                : "potential_discrepancy";

            const label =
              comparisonStatus === "match"
                ? "Match"
                : comparisonStatus === "potential_discrepancy"
                ? "Potential Discrepancy"
                : "ERP Not Entered";

            return (
              <Card key={session.id}>
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-sm">{session.subjectName}</p>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {session.subjectCode}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {session.category}
                      </Badge>
                      {session.slot ? (
                        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary font-mono">
                          {session.slot}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(session.scheduledDate)} · {formatClock(session.scheduledStartAt)} – {formatClock(session.scheduledEndAt)} IST
                    </p>
                    {session.note ? (
                      <p className="mt-1.5 text-xs text-primary font-medium bg-primary/5 px-2 py-1 rounded border border-primary/20 inline-block">
                        💬 Keynote: {session.note}
                      </p>
                    ) : null}
                    <div className="mt-2.5 flex flex-wrap gap-4 text-xs">
                      <span>
                        AttendWise Record: <strong>{personal}</strong>
                      </span>
                      <span>
                        College ERP:{" "}
                        <strong className={session.erpStatus ? "text-foreground font-semibold" : "text-muted-foreground"}>
                          {session.erpStatus ? `${session.erpStatus} (Locked)` : "Not Entered"}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <StateBadge status={comparisonStatus}>{label}</StateBadge>
                    <div className="flex items-center gap-2">
                      {session.erpStatus ? (
                        <Badge
                          variant="outline"
                          className={
                            session.erpStatus === "Present"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-medium"
                              : "bg-rose-50 text-rose-700 border-rose-200 text-xs font-medium"
                          }
                        >
                          ERP: {session.erpStatus} (Locked)
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          ERP Not Recorded
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 gap-1"
                        onClick={() => {
                          setSelectedSession(session);
                          setDialogOpen(true);
                        }}
                      >
                        <TableProperties className="h-3 w-3" /> View Card
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No finalized sessions for comparison"
          detail="Once sessions pass their scheduled interval and attendance is recorded, they will appear here for manual ERP comparison."
        />
      )}

      <AttendanceCardDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        session={selectedSession}
        user={user}
      />
    </>
  );
}

// Session Detail View with Camera Capture
function SessionDetail({
  user,
  sessionId,
  sessions,
  onRecordErp,
  onMarkPresent,
}: {
  user: FirebaseUser;
  sessionId: string;
  sessions: ClassSessionItem[];
  onRecordErp?: (sessionId: string, status: "Present" | "Absent") => Promise<void>;
  onMarkPresent?: (sessionId: string, photoUrl?: string) => Promise<void>;
}) {
  const session = sessions.find((s) => s.id === sessionId);
  const [events, setEvents] = useState<AttendanceEventItem[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Live Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Listen to attendance events for this session
  useEffect(() => {
    const q = collection(db, "users", user.uid, "attendanceEvents");
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: AttendanceEventItem[] = [];
        snap.forEach((d) => {
          const item = d.data() as AttendanceEventItem;
          if (item.sessionId === sessionId) {
            list.push(item);
          }
        });
        list.sort((a, b) => new Date(b.serverTimestamp).getTime() - new Date(a.serverTimestamp).getTime());
        setEvents(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}/attendanceEvents`);
      }
    );
    return () => unsub();
  }, [user.uid, sessionId]);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 100);
    } catch (e: any) {
      setError("Camera permission denied or camera not found. You can still mark attendance without a photo.");
      setCameraActive(false);
    }
  };

  const snapPhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      setCapturedPhotoUrl(dataUrl);
    }
    // Stop camera stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const handleMarkPresent = async () => {
    if (!session) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (onMarkPresent) {
        await onMarkPresent(session.id, capturedPhotoUrl || undefined);
        setMessage("Attendance marked Present on AttendWise.");
      } else {
        const res = await markSessionPresent(user.uid, session.id, capturedPhotoUrl || undefined);
        setMessage(res.message);
      }
    } catch (err: any) {
      setError(err?.message || "Attendance could not be marked.");
    } finally {
      setBusy(false);
    }
  };

  const handleRecordErpDirect = async (status: "Present" | "Absent") => {
    if (!session) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (onRecordErp) {
        await onRecordErp(session.id, status);
      } else {
        await recordSessionErpStatus(user.uid, session.id, status);
      }
      setMessage(`ERP attendance status successfully recorded as ${status}.`);
    } catch (err: any) {
      setError(err?.message || "Could not record ERP status.");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await cancelClassSession(user.uid, session.id);
      setConfirmCancel(false);
      setMessage("Class cancelled. It will not count toward attendance denominators.");
    } catch (err: any) {
      setError(err?.message || "Could not cancel class.");
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <EmptyState
        title="Class session not found"
        detail="The requested class session could not be located in your schedule."
        action={
          <Link href="/timetable" className="text-xs font-semibold text-primary hover:underline">
            Back to timetable
          </Link>
        }
      />
    );
  }

  const nowMs = Date.now();
  const startMs = new Date(session.scheduledStartAt).getTime();
  const endMs = new Date(session.scheduledEndAt).getTime();
  const inWindow = !session.finalized && nowMs >= startMs && nowMs < endMs;

  return (
    <>
      <PageHeading
        title={session.subjectName}
        description={`${session.subjectCode} (${session.category}) · ${formatDate(session.scheduledDate)}`}
        action={
          <Link href="/history" className="text-xs text-primary hover:underline">
            Back to history
          </Link>
        }
      />

      {message ? (
        <Alert className="mb-4">
          <CheckCircle2 className="h-4 w-4 text-accent-foreground" />
          <AlertDescription className="text-xs">{message}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <CircleAlert className="h-4 w-4" />
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Session Details</CardTitle>
              <StateBadge status={session.personalStatus}>{sessionStatusLabel(session)}</StateBadge>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Scheduled Interval · IST
                  </p>
                  <p className="mt-2 font-semibold text-sm">{formatDate(session.scheduledStartAt)}</p>
                  <p className="mt-1 text-xs">
                    {formatTime(session.scheduledStartAt)} – {formatTime(session.scheduledEndAt)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Server Receipt · IST
                  </p>
                  <p className="mt-2 font-semibold text-sm">
                    {session.serverReceiptAt ? formatDateTime(session.serverReceiptAt) : "Not recorded"}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Authoritative server timestamps validate eligibility.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 text-xs">
                <div>
                  <p className="text-muted-foreground">ERP Status</p>
                  <p className="mt-1 font-semibold">{session.erpStatus ?? "ERP Not Entered"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Finalization</p>
                  <p className="mt-1 font-semibold">
                    {session.finalizedAt ? formatDateTime(session.finalizedAt) : session.finalized ? "Finalized" : "Pending"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Room / Lab</p>
                  <p className="mt-1 font-semibold">{session.room ?? "SISTec Campus"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Optional Photo Evidence</p>
                  <p className="mt-1 font-semibold">
                    {session.evidenceAvailable ? "Photo Context Saved" : "No photo attached"}
                  </p>
                </div>
              </div>

              <Alert className="text-xs bg-muted/30">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <AlertDescription>
                  Attendance window is strictly enforced: marks are accepted only between the scheduled start and end instant.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attendance Event Timeline</CardTitle>
              <p className="text-xs text-muted-foreground">Authoritative audit log stored in Firestore.</p>
            </CardHeader>
            <CardContent>
              {events.length ? (
                <ol className="space-y-4">
                  {events.map((ev) => (
                    <li key={ev.id} className="flex gap-3 text-xs">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-primary mt-0.5">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <div>
                        <p className="font-medium text-foreground">{ev.message}</p>
                        <p className="text-[11px] text-muted-foreground">{formatDateTime(ev.serverTimestamp)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  title="No timeline events"
                  detail="Events will be logged automatically as actions occur on this session."
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Session Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {inWindow ? (
                <div className="rounded-lg border p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Class interval active: {formatTime(session.scheduledStartAt)} – {formatTime(session.scheduledEndAt)}.
                  </p>

                  {/* Optional Camera Capture Section */}
                  <div className="space-y-2 pt-2 border-t">
                    <p className="text-xs font-semibold">Optional Photo Context</p>

                    {cameraActive ? (
                      <div className="space-y-2">
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-40 object-cover rounded-lg border bg-black"
                        />
                        <Button size="sm" onClick={snapPhoto} className="w-full text-xs">
                          <Camera className="h-3.5 w-3.5 mr-1.5" /> Snap Photo
                        </Button>
                      </div>
                    ) : capturedPhotoUrl ? (
                      <div className="space-y-2">
                        <img
                          src={capturedPhotoUrl}
                          alt="Captured photo preview"
                          className="w-full h-32 object-cover rounded-lg border"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCapturedPhotoUrl(null)}
                          className="w-full text-xs"
                        >
                          Retake / Remove
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={startCamera}
                        className="w-full text-xs"
                      >
                        <Camera className="h-3.5 w-3.5 mr-1.5" /> Enable Live Camera (Optional)
                      </Button>
                    )}
                  </div>

                  <Button
                    className="w-full mt-2 font-medium"
                    disabled={busy}
                    onClick={handleMarkPresent}
                  >
                    {busy ? "Validating & Recording…" : "Mark Present"}
                    <CheckCircle2 className="h-4 w-4 ml-1.5" />
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg bg-muted/40 p-4 text-xs text-muted-foreground leading-relaxed">
                  {session.personalStatus === "present"
                    ? "Attendance marked Present on AttendWise. Verified by server timestamp."
                    : session.personalStatus === "cancelled"
                    ? "This session was cancelled and is excluded from attendance percentages."
                    : session.personalStatus === "absent" || Date.now() >= new Date(session.scheduledEndAt).getTime()
                    ? `Attendance window is closed (${formatTime(session.scheduledStartAt)} – ${formatTime(session.scheduledEndAt)} IST). Automatically recorded as Absent on AttendWise.`
                    : `Attendance window is not open yet. Scheduled: ${formatTime(session.scheduledStartAt)} – ${formatTime(session.scheduledEndAt)} IST.`}
                </div>
              )}

              {/* College ERP Attendance Section - always visible and enabled even when class timing is gone */}
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-xs font-semibold flex items-center gap-1.5">
                      <TableProperties className="h-3.5 w-3.5 text-primary" />
                      Mark Attendance on ERP
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Record status observed on college ERP portal.
                    </p>
                  </div>
                  {session.erpStatus ? (
                    <Badge
                      variant="outline"
                      className={
                        session.erpStatus === "Present"
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 text-xs font-medium"
                          : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 text-xs font-medium"
                      }
                    >
                      ERP: {session.erpStatus} (Locked)
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      ERP: Not Recorded
                    </Badge>
                  )}
                </div>

                {session.erpStatus !== null ? (
                  <div className="rounded-lg bg-card p-3 border text-xs">
                    <p className="font-medium text-foreground flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-primary" /> ERP Record Finalized
                    </p>
                    <p className="text-muted-foreground text-[11px] mt-0.5">
                      ERP status has been permanently recorded as <strong>{session.erpStatus}</strong> and cannot be altered.
                    </p>
                  </div>
                ) : session.scheduledDate === formatDateKey(new Date()) ? (
                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs font-medium border-emerald-500/40 hover:bg-emerald-600 hover:text-white"
                        disabled={busy}
                        onClick={() => handleRecordErpDirect("Present")}
                      >
                        <Check className="mr-1.5 h-3.5 w-3.5" /> Mark Present on ERP
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs font-medium border-rose-500/40 hover:bg-rose-600 hover:text-white"
                        disabled={busy}
                        onClick={() => handleRecordErpDirect("Absent")}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" /> Mark Absent on ERP
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center">
                      Once recorded, ERP status is permanent and uneditable.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    ERP marking is only permitted on the scheduled class date.
                  </p>
                )}
              </div>

              {!session.finalized && session.personalStatus === "upcoming" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setConfirmCancel(true)}
                >
                  Cancel this class
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Class Session?</DialogTitle>
            <DialogDescription>
              Cancelled classes are not counted as absences and are excluded from attendance denominators.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              Keep Class
            </Button>
            <Button variant="destructive" disabled={busy} onClick={handleCancel}>
              {busy ? "Cancelling…" : "Confirm Cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Profile & Settings View
function ProfileView({
  user,
  profile,
  onLogout,
}: {
  user: FirebaseUser;
  profile?: StudentProfile | null;
  onLogout: () => void;
}) {
  const [target, setTarget] = useState(profile?.attendanceTarget ?? 75);
  const [saved, setSaved] = useState(false);

  const saveTarget = async () => {
    try {
      await updateDoc(doc(db, "users", user.uid), {
        attendanceTarget: Number(target),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <PageHeading title="Profile & Settings" description="Your authenticated SISTec student account information." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Student Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 text-sm">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/20 text-lg font-bold text-primary">
                {profile?.displayName?.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "ST"}
              </span>
              <div>
                <p className="font-bold text-base">{profile?.displayName || "Student"}</p>
                <p className="text-xs text-muted-foreground">{profile?.email || user.email}</p>
                <Badge variant="outline" className="mt-1 text-[10px]">
                  SISTec Student
                </Badge>
              </div>
            </div>

            <Separator />

            <dl className="space-y-3.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Institution</dt>
                <dd className="font-medium text-right">{SISTEC_METADATA.institution}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Course & Semester</dt>
                <dd className="font-medium">{SISTEC_METADATA.course}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Academic Session</dt>
                <dd className="font-medium">{SISTEC_METADATA.session}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Timezone</dt>
                <dd className="font-medium">India Standard Time (Asia/Kolkata)</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Student UID</dt>
                <dd className="font-mono text-[11px] text-muted-foreground">{user.uid}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Attendance Target</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="target-input" className="text-xs">
                  Personal Target Percentage
                </Label>
                <div className="flex gap-3">
                  <Input
                    id="target-input"
                    type="number"
                    min={50}
                    max={100}
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                  />
                  <Button onClick={saveTarget} size="sm">
                    Save Target
                  </Button>
                </div>
                {saved ? <p className="text-xs text-accent-foreground font-medium">Target updated successfully!</p> : null}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The standard SISTec college recommendation is 75%. This goal is used to measure your progress on the dashboard.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account & Security</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Signed in with Firebase Authentication. To sign out of your account on this device:
              </p>
              <Button variant="outline" size="sm" onClick={onLogout} className="text-destructive hover:bg-destructive/10">
                <LogOut className="h-4 w-4 mr-1.5" /> Sign Out
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

// Router and Main Application
export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [timetable, setTimetable] = useState<TimetableItem[]>([]);
  const [sessions, setSessions] = useState<ClassSessionItem[]>([]);
  const [, setLocation] = useLocation();

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser) {
        // Ensure authentic SISTec timetable and subjects are loaded in Firestore
        try {
          await ensureSistecTimetableLoaded(currentUser.uid);
        } catch (err) {
          console.error("Failed to load initial SISTec timetable:", err);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Listen to Firestore data when user is authenticated
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setSubjects([]);
      setTimetable([]);
      setSessions([]);
      return;
    }

    // 1. Profile listener
    const unsubProfile = onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as StudentProfile);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      }
    );

    // 2. Subjects listener
    const unsubSubjects = onSnapshot(
      collection(db, "users", user.uid, "subjects"),
      (snap) => {
        const list: SubjectItem[] = [];
        snap.forEach((d) => list.push(d.data() as SubjectItem));
        setSubjects(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}/subjects`);
      }
    );

    // 3. Timetable listener
    const unsubTimetable = onSnapshot(
      collection(db, "users", user.uid, "timetableEntries"),
      (snap) => {
        const list: TimetableItem[] = [];
        snap.forEach((d) => list.push(d.data() as TimetableItem));
        setTimetable(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}/timetableEntries`);
      }
    );

    // 4. Class sessions listener
    const unsubSessions = onSnapshot(
      collection(db, "users", user.uid, "classSessions"),
      (snap) => {
        const list: ClassSessionItem[] = [];
        snap.forEach((d) => {
          const item = d.data() as ClassSessionItem;
          if (isTeachingDay(item.scheduledDate)) {
            list.push(item);
          }
        });
        setSessions(list);
        // Auto-finalize any overdue sessions
        void finalizeExpiredSessionsForStudent(user.uid, list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}/classSessions`);
      }
    );

    return () => {
      unsubProfile();
      unsubSubjects();
      unsubTimetable();
      unsubSessions();
    };
  }, [user]);

  const handleLogout = async () => {
    await logOutStudent();
    setLocation("/");
  };

  // Real-time optimistic action handlers for instant feedback on user actions:
  const handleRecordErp = async (sessionId: string, status: "Present" | "Absent") => {
    // 1. Instant optimistic update so analytics recompute with 0ms delay:
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, erpStatus: status } : s))
    );
    // 2. Persist to Firestore:
    if (user) {
      await recordSessionErpStatus(user.uid, sessionId, status);
    }
  };

  const handleMarkPresentQuick = async (sessionId: string, photoUrl?: string) => {
    const nowIso = new Date().toISOString();
    // 1. Instant optimistic update:
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              personalStatus: "present",
              finalized: true,
              finalizedAt: nowIso,
              serverReceiptAt: nowIso,
            }
          : s
      )
    );
    // 2. Persist to Firestore:
    if (user) {
      await markSessionPresent(user.uid, sessionId, photoUrl);
    }
  };

  const handleMarkAbsentQuick = async (sessionId: string) => {
    const nowIso = new Date().toISOString();
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              personalStatus: "absent",
              finalized: true,
              finalizedAt: nowIso,
            }
          : s
      )
    );
    if (user) {
      await markSessionAbsent(user.uid, sessionId);
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <LoadingBlock />
      </div>
    );
  }

  if (!user) {
    return <AuthWelcome onAuthSuccess={() => setLocation("/dashboard")} />;
  }

  return (
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Shell profile={profile} onLogout={handleLogout}>
          <ErrorBoundary>
            <Switch>
              <Route
                path="/"
                component={() => (
                  <Dashboard
                    user={user}
                    profile={profile}
                    sessions={sessions}
                    subjects={subjects}
                    onRecordErp={handleRecordErp}
                    onMarkPresent={handleMarkPresentQuick}
                    onMarkAbsent={handleMarkAbsentQuick}
                  />
                )}
              />
              <Route
                path="/dashboard"
                component={() => (
                  <Dashboard
                    user={user}
                    profile={profile}
                    sessions={sessions}
                    subjects={subjects}
                    onRecordErp={handleRecordErp}
                    onMarkPresent={handleMarkPresentQuick}
                    onMarkAbsent={handleMarkAbsentQuick}
                  />
                )}
              />
              <Route
                path="/timetable"
                component={() => <Timetable user={user} timetable={timetable} subjects={subjects} />}
              />
              <Route path="/calendar" component={AcademicCalendarView} />
              <Route
                path="/history"
                component={() => (
                  <AttendanceHistory
                    user={user}
                    sessions={sessions}
                    subjects={subjects}
                    onRecordErp={handleRecordErp}
                    onMarkPresent={handleMarkPresentQuick}
                    onMarkAbsent={handleMarkAbsentQuick}
                  />
                )}
              />
              <Route
                path="/subjects"
                component={() => <Subjects user={user} subjects={subjects} sessions={sessions} />}
              />
              <Route
                path="/comparison"
                component={() => (
                  <Comparison user={user} sessions={sessions} />
                )}
              />
              <Route
                path="/profile"
                component={() => <ProfileView user={user} profile={profile} onLogout={handleLogout} />}
              />
              <Route path="/session/:sessionId">
                {(params) => (
                  <SessionDetail
                    user={user}
                    sessionId={params.sessionId}
                    sessions={sessions}
                    onRecordErp={handleRecordErp}
                    onMarkPresent={handleMarkPresentQuick}
                  />
                )}
              </Route>
              <Route component={NotFound} />
            </Switch>
          </ErrorBoundary>
        </Shell>
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}
