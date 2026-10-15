import { type ComponentType, type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  Activity, ArrowRight, BookOpen, CalendarDays,
  Check, CheckCircle2, ChevronRight, CircleAlert, Clock3, GraduationCap,
  LayoutDashboard, LogOut, Menu, Plus, Settings, ShieldCheck, Sparkles,
  TableProperties, X,
} from 'lucide-react';
import {
  useCancelSession, useCreateSubject, useCreateTimetableEntry, useDeleteSubject,
  useDeleteTimetableEntry, useEndDemoSession, useGetAttendanceHistory,
  useGetDashboardSummary, useGetDashboardToday, useGetDemoProfile,
  useGetErpComparison, useGetSession, useGetSubjectAttendance, useHealthCheck,
  useListSessions, useListSessionEvents, useListSubjects, useListTimetable,
  useMarkPresent, useRecordErpStatus, useStartDemoSession, useUpdateSubject,
  useUpdateTimetableEntry,
} from '../../../lib/api-client-react/src/generated/api.ts';
import type {
  ClassSession, ErpStatus, GetAttendanceHistoryParams, Subject,
  TimetableEntry,
} from '../../../lib/api-client-react/src/generated/api.schemas.ts';
import { Button } from '@workspace/attendwise-design-system/components/ui/button';
import { Badge } from '@workspace/attendwise-design-system/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/attendwise-design-system/components/ui/card';
import { Progress } from '@workspace/attendwise-design-system/components/ui/progress';
import { Input } from '@workspace/attendwise-design-system/components/ui/input';
import { Label } from '@workspace/attendwise-design-system/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@workspace/attendwise-design-system/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@workspace/attendwise-design-system/components/ui/dialog';
import { Skeleton } from '@workspace/attendwise-design-system/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@workspace/attendwise-design-system/components/ui/alert';
import { Separator } from '@workspace/attendwise-design-system/components/ui/separator';
import { TooltipProvider } from '@workspace/attendwise-design-system/components/ui/tooltip';
import { Toaster } from '@workspace/attendwise-design-system/components/ui/toaster';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TZ = 'Asia/Kolkata';
const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
const formatDate = (value?: string | null) => value ? dateFmt.format(new Date(value)) : '—';
const formatDateTime = (value?: string | null) => value ? `${dateTimeFmt.format(new Date(value))} IST` : '—';
const formatTime = (value?: string | null) => value ? `${timeFmt.format(new Date(value))} IST` : '—';
const formatClock = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date(Date.UTC(2020, 0, 1, h - 5, m - 30)));
};
const asPct = (value: number | null | undefined) => value === null || value === undefined ? 'N/A' : `${Math.round(value)}%`;
const sessionStatusLabel = (session: ClassSession) => session.personalStatus === 'absent' ? 'Automatically marked Absent' : session.personalStatus === 'upcoming' ? 'Upcoming' : session.personalStatus === 'cancelled' ? 'Cancelled' : 'Present';
const statusVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'present' || status === 'Present' || status === 'match') return 'secondary';
  if (status === 'absent' || status === 'Absent' || status === 'cancelled') return 'destructive';
  if (status === 'potential_discrepancy') return 'outline';
  return 'outline';
};
const labelComparison = (status: string) => status === 'match' ? 'Match' : status === 'potential_discrepancy' ? 'Potential Discrepancy' : 'ERP Not Entered';
function StateBadge({ status, children }: { status: string; children: ReactNode }) {
  const color = status === 'present' || status === 'Present' || status === 'match'
    ? 'border-accent/30 bg-accent/20 text-accent-foreground'
    : status === 'absent' || status === 'Absent'
      ? 'border-destructive/20 bg-destructive/10 text-destructive'
      : status === 'potential_discrepancy'
        ? 'border-chart-4/20 bg-chart-4/10 text-chart-4'
        : '';
  return <Badge variant="outline" className={color}>{children}</Badge>;
}

function LoadingBlock() {
  return <div className="space-y-4" aria-label="Loading"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" /></div>;
}
function QueryError({ retry }: { retry: () => void }) {
  return <Alert variant="destructive" className="my-4"><CircleAlert className="h-4 w-4" /><AlertTitle>We couldn’t load this information</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3">Check your connection and try again.<Button variant="outline" size="sm" onClick={retry} data-testid="button-retry">Try again</Button></AlertDescription></Alert>;
}
function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="rounded-lg border border-dashed bg-muted/40 px-5 py-10 text-center"><div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-secondary/20 text-primary"><BookOpen className="h-5 w-5" /></div><h3 className="font-semibold">{title}</h3><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>{action ? <div className="mt-4">{action}</div> : null}</div>;
}
function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{action}</div>;
}
function Shell({ children, profile, onExit }: { children: ReactNode; profile?: { displayName: string }; onExit: () => void }) {
  const [path] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const navItems = [
    { href: '/dashboard', title: 'Dashboard', icon: LayoutDashboard },
    { href: '/timetable', title: 'My Timetable', icon: CalendarDays },
    { href: '/history', title: 'Attendance History', icon: Activity },
    { href: '/subjects', title: 'Subjects', icon: BookOpen },
    { href: '/comparison', title: 'ERP Comparison', icon: TableProperties },
    { href: '/profile', title: 'Profile & Settings', icon: Settings },
  ];
  return <div className="min-h-screen bg-background text-foreground md:flex">
    <aside className={`${mobileNav ? 'block' : 'hidden'} fixed inset-y-0 left-0 z-40 w-72 border-r bg-card p-5 md:sticky md:top-0 md:block md:h-screen md:w-64 md:shrink-0`}>
      <Link href="/dashboard" className="mb-8 flex items-center gap-3 rounded-md font-semibold" data-testid="link-brand"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><GraduationCap className="h-6 w-6" /></span><span className="text-lg">AttendWise<span className="block text-xs font-normal text-muted-foreground">Student demo</span></span></Link>
      <nav className="space-y-1" aria-label="Main navigation">{navItems.map(({ href, title, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileNav(false)} data-testid={`link-nav-${href.slice(1)}`} className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors ${path === href || (href === '/history' && path.startsWith('/session/')) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon className="h-4 w-4" />{title}</Link>)}</nav>
      <div className="mt-8 rounded-lg bg-muted/70 p-4"><Badge variant="outline">Demo Mode</Badge><p className="mt-2 text-xs leading-relaxed text-muted-foreground">A temporary single-student experience. Your demo records reset when the server restarts.</p></div>
      <div className="absolute bottom-5 left-5 right-5 hidden items-center justify-between rounded-lg border p-3 md:flex"><div className="min-w-0"><p className="truncate text-sm font-medium">{profile?.displayName ?? 'Demo student'}</p><p className="text-xs text-muted-foreground">Fixed demo context</p></div><Button variant="ghost" size="icon" aria-label="Exit demo" title="Exit demo" onClick={onExit} data-testid="button-exit-demo"><LogOut className="h-4 w-4" /></Button></div>
    </aside>
    {mobileNav ? <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-foreground/30 md:hidden" onClick={() => setMobileNav(false)} data-testid="button-close-nav" /> : null}
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur sm:px-7">
        <div className="flex items-center gap-3"><Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileNav(true)} data-testid="button-open-nav"><Menu className="h-5 w-5" /></Button><div className="hidden text-sm text-muted-foreground sm:block">AttendWise <span className="px-1">/</span> <span className="text-foreground">{navItems.find((item) => item.href === path)?.title ?? 'Session details'}</span></div><Badge className="sm:hidden" variant="outline">Demo</Badge></div>
        <div className="flex items-center gap-3"><span className="hidden text-sm text-muted-foreground sm:block">{new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date())} · IST</span><span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary/20 text-sm font-semibold text-primary" aria-label="Demo student profile">{profile?.displayName?.split(' ').map((part) => part[0]).join('').slice(0, 2) ?? 'DS'}</span></div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-7 sm:py-8">{children}</main>
      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground sm:px-7">AttendWise is a personal tracking tool. Records do not prove physical presence or determine official college attendance.</footer>
    </div>
  </div>;
}

function Welcome({ onEnter, pending, error }: { onEnter: () => void; pending: boolean; error?: string }) {
  return <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12">
    <div className="grid w-full max-w-5xl items-center gap-12 md:grid-cols-2">
      <section className="order-2 text-center md:order-1 md:text-left"><div className="mb-7 inline-flex items-center gap-3 font-semibold"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><GraduationCap className="h-7 w-7" /></span><span className="text-xl">AttendWise</span></div><Badge variant="outline" className="mb-4">A simple attendance companion</Badge><h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Your attendance,<br className="hidden md:block" /> organized.</h1><p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted-foreground md:mx-0">Track your classes. Understand your attendance. Keep your records in one place.</p>{error ? <Alert variant="destructive" className="mt-5 text-left"><CircleAlert className="h-4 w-4" /><AlertTitle>Demo unavailable</AlertTitle><AlertDescription>{error}. Try again in a moment.</AlertDescription></Alert> : null}<Button size="lg" className="mt-7 w-full sm:w-auto" onClick={onEnter} disabled={pending} data-testid="button-enter-demo">{pending ? 'Opening demo…' : 'Enter Demo Dashboard'}<ArrowRight className="h-4 w-4" /></Button><p className="mt-4 text-xs text-muted-foreground">Demo only · No password or real account needed · Data is temporary</p></section>
      <section className="order-1 mx-auto w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm md:order-2 md:p-8" aria-label="AttendWise overview illustration"><div className="flex items-center justify-between"><span className="text-sm font-medium">Your weekly rhythm</span><CalendarDays className="h-5 w-5 text-secondary" /></div><div className="mt-7 rounded-xl bg-muted/70 p-5"><div className="mb-5 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><BookOpen className="h-5 w-5" /></div><div><p className="font-semibold">A clearer view of class</p><p className="text-sm text-muted-foreground">Your schedule, all together</p></div></div><div className="space-y-3">{['Monday', 'Wednesday', 'Friday'].map((day, index) => <div key={day} className="flex items-center gap-3 rounded-lg border bg-card p-3"><div className={`h-9 w-1 rounded-full ${index === 1 ? 'bg-secondary' : 'bg-primary'}`} /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{day}</p><p className="text-xs text-muted-foreground">Weekly schedule</p></div><CheckCircle2 className="h-4 w-4 text-accent-foreground" /></div>)}</div></div><div className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />A private-feeling demo context for exploring your attendance records. This is not secure authentication.</div></section>
    </div>
  </main>;
}

function SummaryCard({ title, percentage, note, icon: Icon, color }: { title: string; percentage: number | null; note: string; icon: typeof Activity; color: string }) {
  return <Card><CardContent className="p-5"><div className="flex items-start justify-between"><div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-3 text-3xl font-semibold tracking-tight">{asPct(percentage)}</p></div><span className={`rounded-lg p-2 ${color}`}><Icon className="h-5 w-5" /></span></div>{percentage !== null ? <Progress className="mt-4" value={percentage} aria-label={`${title} progress`} /> : <p className="mt-4 text-xs text-muted-foreground">No finalized classes yet</p>}<p className="mt-2 text-xs text-muted-foreground">{note}</p></CardContent></Card>;
}
function SessionLink({ session, compact = false }: { session: ClassSession; compact?: boolean }) {
  const status = sessionStatusLabel(session);
  return <Link href={`/session/${session.id}`} className={`flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted/60 ${compact ? 'border' : ''}`} data-testid={`link-session-${session.id}`}>
    <div className="hidden h-9 w-1 shrink-0 rounded-full bg-secondary sm:block" />
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{session.subjectName}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(session.scheduledDate)} · {formatTime(session.scheduledStartAt)} – {formatTime(session.scheduledEndAt)}</p></div>
    <div className="flex flex-col items-end gap-1"><StateBadge status={session.personalStatus}>{status}</StateBadge>{session.finalized ? <span className="text-xs text-muted-foreground">Finalized</span> : null}{session.erpStatus ? <span className="text-xs text-muted-foreground">ERP {session.erpStatus}</span> : null}</div><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
  </Link>;
}
function Dashboard() {
  const summary = useGetDashboardSummary();
  const today = useGetDashboardToday();
  const sessions = useListSessions();
  const profile = useGetDemoProfile();
  const health = useHealthCheck();
  if (summary.isLoading || today.isLoading || profile.isLoading) return <LoadingBlock />;
  if (summary.isError || today.isError || profile.isError) return <QueryError retry={() => { void summary.refetch(); void today.refetch(); void profile.refetch(); }} />;
  const metrics = summary.data;
  const recent = [...(sessions.data ?? [])].filter((s) => s.personalStatus !== 'upcoming').sort((a, b) => +new Date(b.scheduledStartAt) - +new Date(a.scheduledStartAt)).slice(0, 4);
  const todaySessions = today.data?.sessions ?? [];
  return <>
    <PageHeading title={`Good day, ${profile.data?.displayName?.split(' ')[0] ?? 'student'}.`} description="Your academic attendance at a glance." action={<Badge variant="outline" data-testid="status-demo-mode"><Sparkles className="mr-1 h-3 w-3" /> Demo Mode</Badge>} />
    {health.isError ? <Alert className="mb-4"><CircleAlert className="h-4 w-4" /><AlertTitle>Connection check unavailable</AlertTitle><AlertDescription>Your attendance data may be temporarily unavailable.</AlertDescription></Alert> : null}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Attendance summary">
      <SummaryCard title="Overall Attendance" percentage={metrics?.overall.percentage ?? null} note={`${metrics?.overall.presentCount ?? 0} present of ${metrics?.overall.totalEligible ?? 0} finalized classes`} icon={Activity} color="bg-primary/10 text-primary" />
      <SummaryCard title="Theory Attendance" percentage={metrics?.theory.percentage ?? null} note={`${metrics?.theory.presentCount ?? 0} of ${metrics?.theory.totalEligible ?? 0} finalized theory classes`} icon={BookOpen} color="bg-secondary/15 text-secondary" />
      <SummaryCard title="Practical Attendance" percentage={metrics?.practical.percentage ?? null} note={`${metrics?.practical.presentCount ?? 0} of ${metrics?.practical.totalEligible ?? 0} finalized practical classes`} icon={GraduationCap} color="bg-accent/20 text-accent-foreground" />
      <SummaryCard title="ERP Attendance" percentage={metrics?.erp.percentage ?? null} note={`${metrics?.erp.totalEligible ?? 0} ERP records · ${metrics?.erpNotEnteredCount ?? 0} not entered`} icon={TableProperties} color="bg-chart-4/10 text-chart-4" />
    </section>
    <section className="mt-6 grid gap-6 xl:grid-cols-[1.55fr_1fr]">
      <Card><CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle>Today's Classes</CardTitle><p className="mt-1 text-sm text-muted-foreground">{new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())} · IST</p></div><Link href="/timetable" className="text-sm font-medium text-primary hover:underline" data-testid="link-view-timetable">View timetable <ArrowRight className="ml-1 inline h-4 w-4" /></Link></CardHeader><CardContent>{todaySessions.length ? <div className="divide-y">{todaySessions.map((session) => <div key={session.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center"><SessionLink session={session} /><div className="flex items-center gap-2 pl-3 sm:pl-0">{session.canMarkPresent ? <Link href={`/session/${session.id}`} className="text-sm font-semibold text-primary hover:underline" data-testid={`link-mark-present-${session.id}`}>Mark Present</Link> : <span className="text-xs text-muted-foreground">{session.personalStatus === 'upcoming' ? 'Not in attendance window' : session.finalized ? 'Finalized' : session.personalStatus === 'cancelled' ? 'Class cancelled' : 'Attendance recorded'}</span>}</div></div>)}</div> : <EmptyState title="No classes scheduled today" detail="Your timetable is clear for today. Add recurring classes to keep your week organized." action={<Link href="/timetable" className="text-sm font-semibold text-primary" data-testid="link-empty-timetable">Open timetable</Link>} />}</CardContent></Card>
      <div className="space-y-6"><Card><CardHeader><CardTitle>Attendance Goal</CardTitle><p className="text-sm text-muted-foreground">Your personal target, not an institutional requirement</p></CardHeader><CardContent><div className="mb-3 flex items-end justify-between"><span className="text-sm">Target</span><span className="text-2xl font-semibold">{metrics?.targetPercent ?? 0}%</span></div>{metrics?.overall.percentage !== null && metrics?.overall.percentage !== undefined ? <Progress value={metrics.overall.percentage} aria-label="Progress toward personal attendance target" /> : <p className="text-sm text-muted-foreground">No finalized classes yet</p>}<div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{asPct(metrics?.overall.percentage)} current</span><span>{metrics?.overall.percentage !== null && metrics?.overall.percentage !== undefined && metrics.overall.percentage >= metrics.targetPercent ? <span className="text-accent-foreground">Target reached</span> : 'Keep building consistency'}</span></div></CardContent></Card>
        <Card><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle>Recent Attendance</CardTitle><Link href="/history" className="text-sm text-primary hover:underline" data-testid="link-view-history">View all</Link></CardHeader><CardContent>{sessions.isLoading ? <Skeleton className="h-24 w-full" /> : sessions.isError ? <QueryError retry={() => void sessions.refetch()} /> : recent.length ? <div className="divide-y">{recent.map((session) => <SessionLink key={session.id} session={session} />)}</div> : <EmptyState title="No finalized sessions yet" detail="Recorded attendance will appear here once classes are complete." />}</CardContent></Card>
      </div>
    </section>
  </>;
}

function Timetable() {
  const queryClient = useQueryClient();
  const timetable = useListTimetable();
  const subjects = useListSubjects();
  const createEntry = useCreateTimetableEntry();
  const updateEntry = useUpdateTimetableEntry();
  const deleteEntry = useDeleteTimetableEntry();
  const [day, setDay] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TimetableEntry | null>(null);
  const [error, setError] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [category, setCategory] = useState<'Theory' | 'Practical'>('Theory');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [room, setRoom] = useState('');
  const [entryDay, setEntryDay] = useState(1);
  const busy = createEntry.isPending || updateEntry.isPending || deleteEntry.isPending;
  const entries = (timetable.data ?? []).filter((entry) => entry.dayOfWeek === day && entry.active).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const invalidate = () => { void queryClient.invalidateQueries(); };
  const openForm = (entry?: TimetableEntry) => {
    setEditing(entry ?? null); setEntryDay(entry?.dayOfWeek ?? day); setSubjectId(entry?.subjectId ?? subjects.data?.[0]?.id ?? ''); setCategory(entry?.category ?? 'Theory'); setStartTime(entry?.startTime ?? '09:00'); setEndTime(entry?.endTime ?? '10:00'); setRoom(entry?.room ?? ''); setError(''); setDialogOpen(true);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!subjectId) { setError('Add a subject before scheduling a class.'); return; }
    if (startTime >= endTime) { setError('End time must be later than start time.'); return; }
    const data = { subjectId, dayOfWeek: entryDay, startTime, endTime, category, room: room || null };
    const options = { onSuccess: () => { setDialogOpen(false); setError(''); invalidate(); }, onError: (e: Error) => setError(e.message || 'Could not save this class.') };
    if (editing) updateEntry.mutate({ entryId: editing.id, data }, options);
    else createEntry.mutate({ data }, options);
  };
  if (timetable.isLoading || subjects.isLoading) return <LoadingBlock />;
  if (timetable.isError || subjects.isError) return <QueryError retry={() => { void timetable.refetch(); void subjects.refetch(); }} />;
  return <>
    <PageHeading title="Weekly Timetable" description="Your recurring Monday-to-Saturday class schedule in IST." action={<Button onClick={() => openForm()} data-testid="button-add-class"><Plus className="h-4 w-4" /> Add Class</Button>} />
    <div className="mb-5 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Choose day">{WEEK_DAYS.map((name, index) => <Button key={name} role="tab" aria-selected={day === index + 1} variant={day === index + 1 ? 'default' : 'outline'} size="sm" onClick={() => setDay(index + 1)} data-testid={`tab-day-${name.toLowerCase()}`}>{name}</Button>)}</div>
    <Card><CardHeader><CardTitle>{WEEK_DAYS[day - 1]} Schedule</CardTitle></CardHeader><CardContent>
      {entries.length ? <div className="space-y-3">{entries.map((entry) => <article key={entry.id} className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center" data-testid={`card-timetable-${entry.id}`}><div className="flex min-w-40 items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Clock3 className="h-5 w-5" /></span><div><p className="text-sm font-semibold">{formatClock(entry.startTime)}</p><p className="text-xs text-muted-foreground">to {formatClock(entry.endTime)}</p></div></div><Separator orientation="vertical" className="hidden h-10 sm:block" /><div className="min-w-0 flex-1"><p className="font-medium">{entry.subjectName}</p><div className="mt-1 flex flex-wrap gap-2"><Badge variant="outline">{entry.category}</Badge>{entry.room ? <span className="text-xs text-muted-foreground">{entry.room}</span> : null}</div></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => openForm(entry)} data-testid={`button-edit-class-${entry.id}`}>Edit</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => { if (window.confirm(`Remove ${entry.subjectName} from this recurring timetable?`)) deleteEntry.mutate({ entryId: entry.id }, { onSuccess: invalidate, onError: (e: Error) => setError(e.message) }); }} data-testid={`button-delete-class-${entry.id}`}>Remove</Button></div></article>)}</div> : <EmptyState title="No classes this day" detail="Add a recurring class for this day to build your weekly schedule." action={<Button variant="outline" onClick={() => openForm()} data-testid="button-add-empty-class"><Plus className="h-4 w-4" /> Add a class</Button>} />}
      {error && !dialogOpen ? <Alert variant="destructive" className="mt-4"><CircleAlert className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert> : null}
    </CardContent></Card>
    <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Weekly timetable grid">{WEEK_DAYS.map((name, index) => {
      const dayEntries = (timetable.data ?? []).filter((entry) => entry.dayOfWeek === index + 1 && entry.active).sort((a, b) => a.startTime.localeCompare(b.startTime));
      return <Card key={name} className={day === index + 1 ? 'border-primary' : ''} data-testid={`grid-day-${name.toLowerCase()}`}><CardHeader className="flex-row items-center justify-between space-y-0 pb-3"><CardTitle className="text-base">{name}</CardTitle><Button variant="ghost" size="sm" onClick={() => setDay(index + 1)} aria-label={`Focus ${name} schedule`} data-testid={`button-focus-${name.toLowerCase()}`}>Focus</Button></CardHeader><CardContent className="space-y-2">{dayEntries.length ? dayEntries.map((entry) => <div key={entry.id} className="rounded-md border-l-2 border-primary bg-muted/40 px-3 py-2"><p className="truncate text-sm font-medium">{entry.subjectName}</p><p className="mt-1 text-xs text-muted-foreground">{formatClock(entry.startTime)} – {formatClock(entry.endTime)}</p><p className="text-xs text-muted-foreground">{entry.category}{entry.room ? ` · ${entry.room}` : ''}</p></div>) : <p className="py-3 text-sm text-muted-foreground">No scheduled classes</p>}</CardContent></Card>;
    })}</section>
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? 'Edit timetable class' : 'Add a timetable class'}</DialogTitle><DialogDescription>Update your recurring schedule. Existing finalized attendance history is not rewritten.</DialogDescription></DialogHeader><form onSubmit={save} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="class-subject">Subject</Label><Select value={subjectId} onValueChange={setSubjectId}><SelectTrigger id="class-subject" data-testid="select-class-subject"><SelectValue placeholder="Choose a subject" /></SelectTrigger><SelectContent>{subjects.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="class-day">Day</Label><Select value={String(entryDay)} onValueChange={(v) => setEntryDay(Number(v))}><SelectTrigger id="class-day" data-testid="select-class-day"><SelectValue /></SelectTrigger><SelectContent>{WEEK_DAYS.map((name, i) => <SelectItem key={name} value={String(i + 1)}>{name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="class-category">Category</Label><Select value={category} onValueChange={(v) => setCategory(v as 'Theory' | 'Practical')}><SelectTrigger id="class-category" data-testid="select-class-category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Theory">Theory</SelectItem><SelectItem value="Practical">Practical</SelectItem></SelectContent></Select></div></div>
      <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="class-start">Start time</Label><Input id="class-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required data-testid="input-class-start" /></div><div className="space-y-2"><Label htmlFor="class-end">End time</Label><Input id="class-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required data-testid="input-class-end" /></div></div>
      <div className="space-y-2"><Label htmlFor="class-room">Room (optional)</Label><Input id="class-room" value={room} onChange={(e) => setRoom(e.target.value)} maxLength={80} placeholder="e.g. Lab 204" data-testid="input-class-room" /></div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-class">Cancel</Button><Button type="submit" disabled={busy} data-testid="button-save-class">{busy ? 'Saving…' : editing ? 'Save changes' : 'Add class'}</Button></DialogFooter>
    </form></DialogContent></Dialog>
  </>;
}

function AttendanceHistory() {
  const [filters, setFilters] = useState(() => ({ subjectId: new URLSearchParams(window.location.search).get('subjectId') ?? '', category: '', personalStatus: '', comparisonStatus: '', from: '', to: '' }));
  const params = useMemo<GetAttendanceHistoryParams>(() => ({
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.category ? { category: filters.category as 'Theory' | 'Practical' } : {}),
    ...(filters.personalStatus ? { personalStatus: filters.personalStatus as GetAttendanceHistoryParams['personalStatus'] } : {}),
    ...(filters.comparisonStatus ? { comparisonStatus: filters.comparisonStatus as GetAttendanceHistoryParams['comparisonStatus'] } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  }), [filters]);
  const history = useGetAttendanceHistory(params);
  const subjects = useListSubjects();
  const patch = (key: keyof typeof filters, value: string) => setFilters((old) => ({ ...old, [key]: value }));
  const reset = () => setFilters({ subjectId: '', category: '', personalStatus: '', comparisonStatus: '', from: '', to: '' });
  return <>
    <PageHeading title="Attendance History" description="Review class sessions and compare your personal record with manually entered ERP statuses." />
    <Card className="mb-5"><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <div className="space-y-1"><Label htmlFor="filter-subject">Subject</Label><Select value={filters.subjectId || 'all'} onValueChange={(v) => patch('subjectId', v === 'all' ? '' : v)}><SelectTrigger id="filter-subject" data-testid="filter-subject"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All subjects</SelectItem>{subjects.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="filter-category">Category</Label><Select value={filters.category || 'all'} onValueChange={(v) => patch('category', v === 'all' ? '' : v)}><SelectTrigger id="filter-category" data-testid="filter-category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All classes</SelectItem><SelectItem value="Theory">Theory</SelectItem><SelectItem value="Practical">Practical</SelectItem></SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="filter-status">Personal status</Label><Select value={filters.personalStatus || 'all'} onValueChange={(v) => patch('personalStatus', v === 'all' ? '' : v)}><SelectTrigger id="filter-status" data-testid="filter-personal-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="upcoming">Upcoming</SelectItem><SelectItem value="present">Present</SelectItem><SelectItem value="absent">Absent</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="filter-comparison">ERP comparison</Label><Select value={filters.comparisonStatus || 'all'} onValueChange={(v) => patch('comparisonStatus', v === 'all' ? '' : v)}><SelectTrigger id="filter-comparison" data-testid="filter-comparison"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All comparisons</SelectItem><SelectItem value="match">Match</SelectItem><SelectItem value="potential_discrepancy">Potential Discrepancy</SelectItem><SelectItem value="erp_not_entered">ERP Not Entered</SelectItem></SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="filter-from">From</Label><Input id="filter-from" type="date" value={filters.from} onChange={(e) => patch('from', e.target.value)} data-testid="filter-date-from" /></div>
      <div className="space-y-1"><Label htmlFor="filter-to">To</Label><div className="flex gap-2"><Input id="filter-to" type="date" value={filters.to} onChange={(e) => patch('to', e.target.value)} data-testid="filter-date-to" /><Button variant="outline" size="icon" onClick={reset} aria-label="Clear filters" data-testid="button-clear-filters"><X className="h-4 w-4" /></Button></div></div>
    </CardContent></Card>
    {history.isLoading ? <LoadingBlock /> : history.isError ? <QueryError retry={() => void history.refetch()} /> : history.data?.length ? <Card><CardHeader className="pb-2"><CardTitle>{history.data.length} class{history.data.length === 1 ? '' : 'es'}</CardTitle></CardHeader><CardContent className="p-0"><div className="divide-y">{history.data.map((session) => <SessionLink key={session.id} session={session} compact />)}</div></CardContent></Card> : <EmptyState title="No sessions match these filters" detail="Try changing or clearing your filters. Classes will appear here as sessions are generated." action={<Button variant="outline" onClick={reset} data-testid="button-reset-history">Clear filters</Button>} />}
  </>;
}

function Subjects() {
  const client = useQueryClient();
  const attendance = useGetSubjectAttendance();
  const subjects = useListSubjects();
  const create = useCreateSubject();
  const update = useUpdateSubject();
  const remove = useDeleteSubject();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'Theory' | 'Practical'>('Theory');
  const [formError, setFormError] = useState('');
  const saving = create.isPending || update.isPending || remove.isPending;
  const refresh = () => { void client.invalidateQueries(); };
  const startEdit = (subject?: Subject) => { setEditing(subject ?? null); setName(subject?.name ?? ''); setCategory(subject?.category ?? 'Theory'); setFormError(''); setOpen(true); };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) { setFormError('Enter a subject name.'); return; }
    const options = { onSuccess: () => { setOpen(false); refresh(); }, onError: (err: Error) => setFormError(err.message || 'Unable to save the subject.') };
    if (editing) update.mutate({ subjectId: editing.id, data: { name: cleanName, category } }, options);
    else create.mutate({ data: { name: cleanName, category } }, options);
  };
  if (attendance.isLoading || subjects.isLoading) return <LoadingBlock />;
  if (attendance.isError || subjects.isError) return <QueryError retry={() => { void attendance.refetch(); void subjects.refetch(); }} />;
  const rows = subjects.data ?? [];
  return <>
    <PageHeading title="Subjects" description="Your attendance totals by subject, calculated from finalized eligible sessions." action={<Button onClick={() => startEdit()} data-testid="button-add-subject"><Plus className="h-4 w-4" /> Add Subject</Button>} />
    {formError && !open ? <Alert variant="destructive" className="mb-4"><CircleAlert className="h-4 w-4" /><AlertDescription>{formError}</AlertDescription></Alert> : null}
    {rows.length ? <div className="grid gap-4 lg:grid-cols-2">{rows.map((subject) => {
      const stats = attendance.data?.find((item) => item.subjectId === subject.id);
      return <Card key={subject.id} data-testid={`card-subject-${subject.id}`}><CardContent className="p-5"><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-primary"><BookOpen className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">{subject.name}</h2><Badge className="mt-1" variant="outline">{subject.category}</Badge></div><span className="text-2xl font-semibold">{asPct(stats?.percentage)}</span></div>{stats ? <><Progress className="mt-4" value={stats.percentage ?? 0} aria-label={`${subject.name} attendance`} /><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div><p className="font-semibold">{stats.presentCount}</p><p className="text-muted-foreground">Present</p></div><div><p className="font-semibold">{stats.absentCount}</p><p className="text-muted-foreground">Absent</p></div><div><p className="font-semibold">{stats.totalEligible}</p><p className="text-muted-foreground">Finalized total</p></div></div><p className="mt-3 text-xs text-muted-foreground">Personal target: {stats.targetPercent}%</p></> : <p className="mt-4 text-sm text-muted-foreground">No finalized sessions yet.</p>}<Link href={`/history?subjectId=${encodeURIComponent(subject.id)}`} className="mt-3 inline-flex items-center text-sm font-medium text-primary hover:underline" data-testid={`link-subject-history-${subject.id}`}>View history <ArrowRight className="ml-1 h-4 w-4" /></Link></div></div><Separator className="my-4" /><div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => startEdit(subject)} data-testid={`button-edit-subject-${subject.id}`}>Edit</Button><Button variant="ghost" size="sm" disabled={saving} onClick={() => { if (window.confirm(`Delete ${subject.name}? This also removes future timetable entries.`)) remove.mutate({ subjectId: subject.id }, { onSuccess: refresh, onError: (e: Error) => setFormError(e.message || 'Could not delete subject.') }); }} data-testid={`button-delete-subject-${subject.id}`}>Delete</Button></div></CardContent></Card>;
    })}</div> : <EmptyState title="No subjects yet" detail="Create a subject before adding it to your recurring timetable." action={<Button onClick={() => startEdit()} data-testid="button-create-first-subject"><Plus className="h-4 w-4" /> Create subject</Button>} />}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? 'Edit subject' : 'Create subject'}</DialogTitle><DialogDescription>Subject details help organize your schedule and attendance totals.</DialogDescription></DialogHeader><form onSubmit={save} className="space-y-4"><div className="space-y-2"><Label htmlFor="subject-name">Subject name</Label><Input id="subject-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required data-testid="input-subject-name" /></div><div className="space-y-2"><Label htmlFor="subject-category">Category</Label><Select value={category} onValueChange={(v) => setCategory(v as 'Theory' | 'Practical')}><SelectTrigger id="subject-category" data-testid="select-subject-category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Theory">Theory</SelectItem><SelectItem value="Practical">Practical</SelectItem></SelectContent></Select></div>{formError ? <p className="text-sm text-destructive" role="alert">{formError}</p> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-subject">Cancel</Button><Button disabled={saving} type="submit" data-testid="button-save-subject">{saving ? 'Saving…' : editing ? 'Save changes' : 'Create subject'}</Button></DialogFooter></form></DialogContent></Dialog>
  </>;
}

function Comparison() {
  const client = useQueryClient();
  const comparison = useGetErpComparison();
  const sessions = useListSessions();
  const mark = useRecordErpStatus();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const reload = () => { void client.invalidateQueries(); };
  const selectStatus = (sessionId: string, status: ErpStatus) => {
    setError(''); setNotice('');
    mark.mutate({ sessionId, data: { status } }, { onSuccess: () => { setNotice('ERP status recorded.'); reload(); }, onError: (e: Error) => setError(e.message || 'Could not record this status.') });
  };
  if (comparison.isLoading || sessions.isLoading) return <LoadingBlock />;
  if (comparison.isError || sessions.isError) return <QueryError retry={() => { void comparison.refetch(); void sessions.refetch(); }} />;
  const entries = comparison.data?.entries ?? [];
  return <>
    <PageHeading title="ERP Comparison" description="Compare your personal record with the status you manually observe in your college ERP." />
    <Alert className="mb-5"><ShieldCheck className="h-4 w-4" /><AlertTitle>Manual comparison only</AlertTitle><AlertDescription>AttendWise does not connect to your college ERP. Potential discrepancies are neutral comparisons, not proof that either record is wrong.</AlertDescription></Alert>
    {notice ? <Alert className="mb-4"><CheckCircle2 className="h-4 w-4" /><AlertDescription>{notice}</AlertDescription></Alert> : null}{error ? <Alert variant="destructive" className="mb-4"><CircleAlert className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert> : null}
    <div className="mb-5 grid gap-4 sm:grid-cols-3"><Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Matches</p><p className="mt-2 text-3xl font-semibold">{comparison.data?.matchCount ?? 0}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Potential Discrepancies</p><p className="mt-2 text-3xl font-semibold">{comparison.data?.discrepancyCount ?? 0}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">ERP Not Entered</p><p className="mt-2 text-3xl font-semibold">{comparison.data?.erpNotEnteredCount ?? 0}</p></CardContent></Card></div>
    {entries.length ? <div className="space-y-3">{entries.map((entry) => {
      const session = sessions.data?.find((item) => item.id === entry.sessionId);
      const canRecord = !!session && !session.finalized && entry.personalStatus !== 'upcoming' && entry.personalStatus !== 'cancelled';
      return <Card key={entry.sessionId} data-testid={`card-comparison-${entry.sessionId}`}><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{entry.subjectName}</p><Badge variant="outline">{entry.category}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{formatDate(entry.scheduledDate)}</p><div className="mt-3 flex flex-wrap gap-5 text-sm"><span>My AttendWise Record: <strong>{entry.personalStatus === 'upcoming' ? 'Upcoming' : entry.personalStatus === 'cancelled' ? 'Cancelled' : entry.personalStatus === 'present' ? 'Present' : 'Absent'}</strong></span><span>College ERP Record: <strong>{entry.erpStatus ?? 'ERP Not Entered'}</strong></span></div></div><div className="flex flex-col items-start gap-2 sm:items-end"><StateBadge status={entry.comparisonStatus}>{labelComparison(entry.comparisonStatus)}</StateBadge>{entry.erpStatus === null && canRecord ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => selectStatus(entry.sessionId, 'Present')} data-testid={`button-erp-present-${entry.sessionId}`}>Present</Button><Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => selectStatus(entry.sessionId, 'Absent')} data-testid={`button-erp-absent-${entry.sessionId}`}>Absent</Button></div> : entry.erpStatus ? <span className="text-xs text-muted-foreground">Finalized status is read only</span> : <span className="text-xs text-muted-foreground">Record after class is complete</span>}</div></CardContent></Card>;
    })}</div> : <EmptyState title="No comparison records yet" detail="Completed session records will appear here so you can manually enter what your college ERP shows." />}
  </>;
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const client = useQueryClient();
  const sessionQuery = useGetSession(sessionId, { query: { queryKey: ['/api/sessions', sessionId] } });
  const events = useListSessionEvents(sessionId, { query: { queryKey: ['/api/sessions', sessionId, 'events'] } });
  const mark = useMarkPresent();
  const cancel = useCancelSession();
  const erp = useRecordErpStatus();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [erpChoice, setErpChoice] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const session = sessionQuery.data;
  const refresh = () => { void client.invalidateQueries(); };
  const act = (fn: () => void) => { setError(''); setMessage(''); fn(); };
  if (sessionQuery.isLoading) return <LoadingBlock />;
  if (sessionQuery.isError || !session) return <QueryError retry={() => void sessionQuery.refetch()} />;
  const status = sessionStatusLabel(session);
  const rec = (statusValue: ErpStatus) => erp.mutate({ sessionId, data: { status: statusValue } }, { onSuccess: () => { setMessage('ERP status recorded.'); setErpChoice(''); refresh(); }, onError: (e: Error) => setError(e.message || 'Could not record ERP status.') });
  return <>
    <PageHeading title={session.subjectName} description={`${session.category} class · ${formatDate(session.scheduledDate)}`} action={<Link href="/history" className="text-sm text-primary hover:underline" data-testid="link-back-history">Back to history</Link>} />
    {message ? <Alert className="mb-4"><CheckCircle2 className="h-4 w-4" /><AlertDescription>{message}</AlertDescription></Alert> : null}
    {error ? <Alert variant="destructive" className="mb-4"><CircleAlert className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert> : null}
    <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]"><div className="space-y-6">
      <Card><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle>Session details</CardTitle><Badge variant={statusVariant(session.personalStatus)}>{status}</Badge></CardHeader><CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-lg bg-muted/50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scheduled interval · IST</p><p className="mt-2 font-semibold">{formatDate(session.scheduledStartAt)}</p><p className="mt-1 text-sm">{formatTime(session.scheduledStartAt)} – {formatTime(session.scheduledEndAt)}</p></div><div className="rounded-lg bg-muted/50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Server receipt · IST</p><p className="mt-2 font-semibold">{session.serverReceiptAt ? formatDateTime(session.serverReceiptAt) : 'Not recorded'}</p><p className="mt-1 text-xs text-muted-foreground">Server time is authoritative for mark eligibility.</p></div></div>
        <div className="grid gap-4 sm:grid-cols-2"><div><p className="text-sm text-muted-foreground">ERP status</p><p className="mt-1 font-medium">{session.erpStatus ?? 'ERP Not Entered'}</p></div><div><p className="text-sm text-muted-foreground">Finalization</p><p className="mt-1 font-medium">{session.finalizedAt ? formatDateTime(session.finalizedAt) : session.finalized ? 'Finalized' : 'Not finalized'}</p></div><div><p className="text-sm text-muted-foreground">Room</p><p className="mt-1 font-medium">{session.room ?? 'Not specified'}</p></div><div><p className="text-sm text-muted-foreground">Optional photo context</p><p className="mt-1 font-medium">{session.evidenceAvailable ? 'Photo attached' : 'No photo attached'}</p></div></div>
        <Alert><ShieldCheck className="h-4 w-4" /><AlertDescription>Finalized personal and ERP records cannot be edited. A photo, if present, is optional supporting context and does not independently prove physical presence.</AlertDescription></Alert>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Event timeline</CardTitle><p className="text-sm text-muted-foreground">Recorded events for this session.</p></CardHeader><CardContent>{events.isLoading ? <Skeleton className="h-28 w-full" /> : events.isError ? <QueryError retry={() => void events.refetch()} /> : events.data?.length ? <ol className="space-y-5">{events.data.map((event) => <li key={event.id} className="relative flex gap-3" data-testid={`timeline-event-${event.id}`}><span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-primary"><Check className="h-4 w-4" /></span><div><p className="text-sm font-medium">{event.message}</p><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(event.serverTimestamp)}</p></div></li>)}</ol> : <EmptyState title="No events recorded" detail="Session activity will appear here as it is recorded." />}</CardContent></Card>
    </div><div className="space-y-5"><Card><CardHeader><CardTitle>Session actions</CardTitle></CardHeader><CardContent className="space-y-3">
      {session.canMarkPresent && session.personalStatus === 'upcoming' ? <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Attendance can only be recorded during the exact server-validated scheduled interval.</p><p className="mt-2 text-xs text-muted-foreground">{formatTime(session.scheduledStartAt)} – {formatTime(session.scheduledEndAt)}</p><Button className="mt-4 w-full" disabled={mark.isPending} onClick={() => act(() => mark.mutate({ sessionId, data: {} }, { onSuccess: (updated) => { setMessage(updated.serverReceiptAt ? `Present recorded at ${formatDateTime(updated.serverReceiptAt)}.` : 'Present recorded by the server.'); refresh(); }, onError: (e: Error) => setError(e.message || 'Mark Present was not accepted.') }))} data-testid="button-mark-present">{mark.isPending ? 'Recording…' : 'Mark Present'}<CheckCircle2 className="h-4 w-4" /></Button><p className="mt-3 text-xs text-muted-foreground">Optional photo capture is not enabled. Marking attendance does not assert independent proof of physical presence.</p></div> : <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">{session.finalized ? 'This class is finalized; attendance changes are locked.' : session.personalStatus === 'cancelled' ? 'This class was cancelled and does not count as an absence.' : session.personalStatus === 'present' ? 'Your present mark has been received.' : 'Mark Present is available only inside the exact scheduled interval.'}</p>}
      {session.erpStatus === null && session.personalStatus !== 'upcoming' && session.personalStatus !== 'cancelled' && !session.finalized ? <div className="space-y-2 border-t pt-3"><Label htmlFor="session-erp">College ERP record</Label><Select value={erpChoice} onValueChange={setErpChoice}><SelectTrigger id="session-erp" data-testid="select-session-erp"><SelectValue placeholder="Select observed status" /></SelectTrigger><SelectContent><SelectItem value="Present">Present</SelectItem><SelectItem value="Absent">Absent</SelectItem></SelectContent></Select><Button className="w-full" variant="outline" disabled={!erpChoice || erp.isPending} onClick={() => act(() => rec(erpChoice as ErpStatus))} data-testid="button-save-erp">Record ERP status</Button></div> : null}
      {!session.finalized && session.personalStatus === 'upcoming' ? <Button variant="outline" className="w-full" onClick={() => setConfirmCancel(true)} data-testid="button-cancel-session">Cancel this class</Button> : null}
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}><DialogContent><DialogHeader><DialogTitle>Cancel this class?</DialogTitle><DialogDescription>Cancelled sessions are excluded from your attendance totals. This cannot be undone.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmCancel(false)} data-testid="button-keep-session">Keep class</Button><Button variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate({ sessionId }, { onSuccess: () => { setConfirmCancel(false); setMessage('Class cancelled. It will not count as an absence.'); refresh(); }, onError: (e: Error) => setError(e.message || 'Unable to cancel this class.') })} data-testid="button-confirm-cancel">{cancel.isPending ? 'Cancelling…' : 'Confirm cancellation'}</Button></DialogFooter></DialogContent></Dialog>
    </CardContent></Card><Card><CardContent className="p-4"><p className="text-sm font-medium">Attendance window</p><p className="mt-1 text-sm text-muted-foreground">The server only accepts a mark from the scheduled start instant up to, but not including, the scheduled end instant.</p></CardContent></Card></div></div>
  </>;
}

function Profile() {
  const client = useQueryClient();
  const profile = useGetDemoProfile();
  const summary = useGetDashboardSummary();
  const exit = useEndDemoSession();
  const [, setLocation] = useLocation();
  if (profile.isLoading || summary.isLoading) return <LoadingBlock />;
  if (profile.isError || summary.isError || !profile.data) return <QueryError retry={() => { void profile.refetch(); void summary.refetch(); }} />;
  return <>
    <PageHeading title="Profile & Settings" description="Your fixed demo student context and privacy information." />
    <div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader><CardTitle>Student profile</CardTitle></CardHeader><CardContent><div className="flex items-center gap-4"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary/20 text-lg font-semibold text-primary">{profile.data.displayName.split(' ').map((p) => p[0]).join('').slice(0, 2)}</span><div><p className="font-semibold" data-testid="text-student-name">{profile.data.displayName}</p><p className="text-sm text-muted-foreground">{profile.data.email}</p></div></div><Separator className="my-5" /><dl className="space-y-4 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Account context</dt><dd className="font-medium">Fixed demo student</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Timezone</dt><dd className="font-medium">India Standard Time (IST)</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Personal attendance target</dt><dd className="font-medium">{summary.data?.targetPercent ?? profile.data.attendanceTarget}%</dd></div></dl><Link href="/timetable" className="mt-5 inline-flex items-center text-sm font-medium text-primary hover:underline" data-testid="link-settings-timetable">Manage weekly timetable <ArrowRight className="ml-1 h-4 w-4" /></Link></CardContent></Card>
      <div className="space-y-5"><Card><CardHeader><CardTitle>Demo account</CardTitle></CardHeader><CardContent><p className="text-sm leading-relaxed text-muted-foreground">This is a single-student demo context, not secure authentication. No password or real credentials are collected. In-memory demo records reset when the server restarts.</p><Button variant="outline" className="mt-4" disabled={exit.isPending} onClick={() => exit.mutate(undefined, { onSuccess: () => { void client.clear(); setLocation('/'); }, onError: () => setLocation('/') })} data-testid="button-profile-exit">{exit.isPending ? 'Exiting…' : 'Exit Demo'}<LogOut className="h-4 w-4" /></Button></CardContent></Card><Card><CardHeader><CardTitle>Privacy & optional evidence</CardTitle></CardHeader><CardContent><p className="text-sm leading-relaxed text-muted-foreground">Attendance tracking is personal and does not replace your college system. Optional photo evidence should avoid capturing other students or sensitive information. A photo is supporting context only, not proof of physical presence.</p></CardContent></Card></div>
    </div>
  </>;
}

function RouterContent({ active, setActive, demoError, onEnter, enterPending, profile }: { active: boolean; setActive: (active: boolean) => void; demoError?: string; onEnter: () => void; enterPending: boolean; profile?: { displayName: string } }) {
  const [, setLocation] = useLocation();
  const exit = useEndDemoSession();
  const doExit = () => exit.mutate(undefined, { onSuccess: () => { setActive(false); setLocation('/'); }, onError: () => { setActive(false); setLocation('/'); } });
  const guarded = (Component: ComponentType) => active ? <Shell profile={profile} onExit={doExit}><Component /></Shell> : <Welcome onEnter={onEnter} pending={enterPending} error={demoError} />;
  return <ErrorBoundary>
    <Switch>
      <Route path="/" component={() => <Welcome onEnter={onEnter} pending={enterPending} error={demoError} />} />
      <Route path="/dashboard">{guarded(Dashboard)}</Route>
      <Route path="/timetable">{guarded(Timetable)}</Route>
      <Route path="/history">{guarded(AttendanceHistory)}</Route>
      <Route path="/subjects">{guarded(Subjects)}</Route>
      <Route path="/comparison">{guarded(Comparison)}</Route>
      <Route path="/profile">{guarded(Profile)}</Route>
      <Route path="/session/:sessionId">{(params) => active ? <Shell profile={profile} onExit={doExit}><SessionDetail sessionId={params.sessionId} /></Shell> : <Welcome onEnter={onEnter} pending={enterPending} error={demoError} />}</Route>
      <Route component={NotFound} />
    </Switch>
  </ErrorBoundary>;
}

function AppRouter() {
  const [active, setActive] = useState(false);
  const [demoError, setDemoError] = useState('');
  const [location, setLocation] = useLocation();
  const start = useStartDemoSession();
  const profile = useGetDemoProfile({ query: { enabled: active, queryKey: ['/api/demo/profile'] } });
  const onEnter = () => {
    setDemoError('');
    start.mutate(undefined, { onSuccess: () => { setActive(true); setLocation('/dashboard'); }, onError: (error: Error) => setDemoError(error.message || 'The demo service could not be reached.') });
  };
  return <RouterContent key={location} active={active} setActive={setActive} demoError={demoError} onEnter={onEnter} enterPending={start.isPending} profile={profile.data} />;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppRouter /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
