# AssignEase Persistence Reference

## Handoff document for diagnosing AttendWise

**Purpose:** Provide AttendWise's AI Studio project with a structured
reference to the persistence and synchronization implementation
documented in AssignEase. This is a reference for investigation, not a
request to copy the entire implementation.

## 1. Executive summary

AssignEase is a student assignment-submission application. According to
its technical report, it uses:

-   **Frontend:** React 19, TanStack Start, Vite, TanStack Router.
-   **Client cache and mutations:** TanStack Query v5.
-   **Database:** Google Cloud Firestore (Firebase JavaScript SDK).
-   **Media:** Firebase Cloud Storage, with a client-side Base64
    data-URL fallback.
-   **Authentication:** Firebase Auth, including anonymous and
    email/password authentication.
-   **Cross-device updates:** Firestore `onSnapshot` listeners, followed
    by TanStack Query cache invalidation and refetching.

The important design pattern to investigate is the full lifecycle: write
to Firestore, wait for the write promise to resolve, refresh cached
queries, reload the authoritative record from Firestore, and update the
UI from the retrieved record.

**Important limitation:** The report explicitly says AssignEase's
submission lock is frontend-only. Its Firestore rules do not enforce the
lock. Do not copy that security weakness into AttendWise.

## 2. Technology and responsibility map

  -----------------------------------------------------------------------
  Component               Technology              Role documented in
                                                  AssignEase
  ----------------------- ----------------------- -----------------------
  UI and frontend         React 19 + TanStack     Rendering and
                          Start + Vite            student/teacher
                                                  workflows

  Routing                 TanStack Router         Route navigation

  Query cache             TanStack Query v5       Query caching, mutation
                                                  states,
                                                  invalidation/refetch

  Database                Cloud Firestore         Profiles, assignments,
                                                  submissions, pages,
                                                  marks

  Image storage           Firebase Cloud Storage  Stores scanned
                                                  answer-page images

  Authentication          Firebase Auth           Supplies the
                                                  authenticated
                                                  identity/UID

  Real-time sync          Firestore `onSnapshot`  Detects cloud changes
                                                  and triggers query
                                                  invalidation
  -----------------------------------------------------------------------

This table describes AssignEase only. AttendWise's actual code and
architecture must be inspected separately.

## 3. Student answer submission lifecycle

### 3.1 Uploading an answer page

**Reported source:**
`/src/routes/_authenticated/student/assignments.$assignmentId.tsx`

1.  The student opens `/student/assignments/:assignmentId`.
2.  The student captures or adds a scanned answer page.
3.  The application obtains or creates a submission through
    `getOrCreateSubmission(assignmentId, profile.id)`.
4.  The image is uploaded through `uploadFileToStorage(...)` in
    `/src/lib/db.ts`.
5.  The app writes a document to `submission_pages` using `setDoc`.

The report's representative write is:

``` ts
const pageDocRef = doc(collection(db, "submission_pages"));
await setDoc(pageDocRef, {
  id: pageDocRef.id,
  submission_id: record.id,
  question_no: questionNo,
  page_order: (pages.data?.length || 0) + 1,
  image_url: downloadUrl,
  uploaded_at: new Date().toISOString(),
});
```

The page document references its parent submission via `submission_id`.

### 3.2 Final submission and lock state

**Reported source:**
`/src/routes/_authenticated/student/assignments.$assignmentId.tsx`

The student clicks **Submit Assignment**. The reported mutation updates
the existing submission:

``` ts
await updateDoc(doc(db, "submissions", submission.data.id), {
  status: "submitted",
  submitted_at: new Date().toISOString(),
});
```

After the promise resolves, the application: - Shows a success toast. -
Invalidates the `["my-submission", assignmentId, profile?.id]` query. -
Invalidates the `["submissions"]` query. - Uses the retrieved
`status === "submitted"` to display the submitted/locked UI.

The reported frontend lock expression is:

``` ts
const locked = !assignment.data?.is_open ||
  submission.data?.status === "submitted";
```

This is a UI state rule. By itself, it does not protect the database
against a direct or stale client write.

## 4. Firestore data model documented in AssignEase

### Collection: `submissions`

**Path:** `/submissions/{submissionId}`

Reported fields: - `id` - `assignment_id` - `student_id` ---
authenticated student's UID - `status` --- `"draft"` or `"submitted"` -
`submitted_at` - `total_marks` - `checked_status` - `checked_at` -
`created_at`

The report says `getOrCreateSubmission(...)` uses an automatically
generated Firestore document ID.

### Collection: `submission_pages`

**Path:** `/submission_pages/{pageId}`

Reported fields: - `id` - `submission_id` --- parent submission
reference - `question_no` - `page_order` - `image_url` - `uploaded_at`

### Collection: `question_marks`

**Path:** `/question_marks/{markDocId}`

Reported document ID pattern: `${submissionId}_q${questionNo}`.

Reported fields include `id`, `submission_id`, `question_no`,
`marks_awarded`, `feedback`, and `created_at`.

These are AssignEase schemas only. Do not transplant these collection
names or field names into AttendWise unless its own schema and migration
requirements have been explicitly reviewed.

## 5. How AssignEase restores saved answers

The report describes this reload flow:

1.  Read the student's profile from `/profiles/{uid}`.
2.  Fetch the assignment from `/assignments/{assignmentId}`.
3.  Query `/submissions` by `assignment_id`, then find the record whose
    `student_id` matches the student's profile ID.
4.  Once the submission ID is known, query `/submission_pages` by
    `submission_id`.
5.  Sort pages by `question_no`, then `page_order`.
6.  Fetch question marks by `submission_id`.

The report's representative page retrieval function is:

``` ts
export async function listPages(submissionId: string): Promise<SubmissionPage[]> {
  try {
    const q = query(
      collection(db, "submission_pages"),
      where("submission_id", "==", submissionId)
    );
    const snap = await getDocs(q);
    const pages = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<SubmissionPage, "id">),
    }));
    return pages.sort((a, b) => {
      if (a.question_no !== b.question_no) {
        return a.question_no - b.question_no;
      }
      return (a.page_order || 0) - (b.page_order || 0);
    });
  } catch (err) {
    console.warn("Error listing submission pages:", err);
    return [];
  }
}
```

**Caution:** This function catches read errors and returns an empty
array. An empty UI can therefore mean either "no pages exist" or "the
read failed." AttendWise should not silently convert a read failure into
a misleading "no attendance" state.

## 6. How cross-device updates are propagated

The report documents Firestore `onSnapshot` listeners that invalidate
TanStack Query keys.

### Global student listener

**Reported source:**
`/src/components/student-grade-notification-listener.tsx`

The listener queries submissions matching `student_id === profile.id`,
then invalidates: - `["submissions"]` - `["my-submissions"]` -
`["my-submission"]`

### Student dashboard listener

**Reported source:** `/src/routes/_authenticated/student/index.tsx`

The dashboard listens to the `submissions` and `assignments` collections
and invalidates the corresponding query keys.

### Important limitation

The report says the student-side global listener watches submissions,
not `submission_pages`. As a result, page uploads made from another
device may not appear immediately in an already-open page list. The
report also describes invalidation/refetch, not direct rendering of
every snapshot payload.

For AttendWise, investigate whether its listeners cover the exact
attendance documents and evidence fields that the UI needs, and whether
listeners surface errors and clean up correctly.

## 7. Locking and security findings --- do not copy blindly

The report explicitly identifies a significant weakness in AssignEase:

-   The frontend hides or disables editing controls after
    `status === "submitted"`.
-   The reported Firestore rules allow any authenticated user to read,
    create, update, and delete submission documents and submission-page
    documents.
-   The report says there is no server-side middleware or Cloud Function
    enforcing the submitted lock.
-   Therefore, the frontend lock is not a reliable database-level
    immutability guarantee.

**Lesson for AttendWise:** The UI should reflect the lock, but
authoritative cloud-side rules or trusted backend logic must prevent
invalid status transitions and unauthorized changes. A
successful-looking UI is not proof of a secure, permanently locked
record.

Do not copy the sample Firestore rules from the AssignEase report
directly into AttendWise. They are illustrative and need to be designed
for AttendWise's own authentication, roles, schema, and valid
transitions.

## 8. Concurrency and duplicate-record concern in AssignEase

The report says `getOrCreateSubmission(assignmentId, studentId)`: 1.
Queries for an existing record by assignment and student. 2. If none is
found, creates a new record with an automatically generated ID.

Because the query and create are separate operations, simultaneous calls
could both see no record and create duplicates. The report recommends
deterministic document IDs as one possible mitigation, but any change to
an existing database identity strategy requires careful migration and
compatibility review.

**Lesson for AttendWise:** Trace how it identifies a single attendance
record for one student and one scheduled session. Verify that
submission, reload, finalizer, and other clients all target the same
canonical record. Do not change existing document IDs or schemas without
a safe migration plan.

## 9. Image upload behavior documented in AssignEase

The report says `uploadFileToStorage(...)`: - Compresses the image when
needed. - Attempts Firebase Storage upload and retrieval of a download
URL. - Races the upload against a 1.5-second timeout. - Falls back to a
Base64 data URL if the Storage operation throws or times out. - Saves
the resulting URL/data URL in the `submission_pages` document.

This is a documented fallback strategy, not a guarantee that every
upload succeeded or that Base64-in-Firestore is suitable for AttendWise.
The report notes that the Storage upload promise may continue after the
timeout race rejects. AttendWise should use a clear, verified
evidence-persistence workflow and should never report evidence saved
until the necessary upload and database writes are confirmed.

## 10. Relevant AssignEase source files

  --------------------------------------------------------------------------------------------------------
  Source path                                                          Reported responsibility
  -------------------------------------------------------------------- -----------------------------------
  `/src/routes/_authenticated/student/assignments.$assignmentId.tsx`   Student assignment page, scan
                                                                       upload mutation, final submit
                                                                       mutation, frontend lock

  `/src/components/camera-capture.tsx`                                 Camera capture and image processing

  `/src/lib/db.ts`                                                     Firestore data functions,
                                                                       submission creation, page
                                                                       retrieval, image upload

  `/src/hooks/use-assignease.ts`                                       Profile, signed URL, and session
                                                                       hooks

  `/src/components/student-grade-notification-listener.tsx`            Global student submission listener

  `/src/routes/_authenticated/student/index.tsx`                       Student dashboard listeners

  `/src/routes/_authenticated/teacher/assignments.$assignmentId.tsx`   Teacher assignment submission
                                                                       listener

  `/src/routes/_authenticated/teacher/grade.$submissionId.tsx`         Teacher grading and marks

  `/firestore.rules`                                                   Database access rules
  --------------------------------------------------------------------------------------------------------

The excerpts and paths above are transcribed from the supplied
AssignEase report. The actual AssignEase source repository was not
independently inspected as part of this handoff.

## 11. Instructions for the AttendWise investigation

Use this report as a **reference only**. Inspect AttendWise's actual
code before drawing conclusions.

1.  Trace the AttendWise Present write from the user's action to the
    actual Firestore document.
2.  Confirm the exact student ID, session ID, document path, fields, and
    server response.
3.  Reload the dashboard and confirm which document/query determines the
    attendance-card status.
4.  Trace every path that writes Absent or finalizes attendance.
    Establish whether any process can overwrite a confirmed Present.
5.  Inspect all listeners and queries used by the attendance card and
    the cross-device dashboard.
6.  Separate the class timing state (such as `In Progress`) from the
    student's attendance state (`Present`/`Absent`).
7.  Verify that evidence upload and attendance status writes cannot
    leave the UI claiming a complete save when only part of the
    operation succeeded.
8.  Identify and report the root cause with file/function evidence
    **before editing code**.
9.  Make the smallest safe fix, preserve existing production data, and
    test with a dedicated test account/session.
10. Report which tests were actually executed. Do not claim cross-device
    or production-cloud verification without performing it.

### Required test cases

-   Mark Present, confirm the cloud write, reload, and verify the card.
-   Sign in to the same account on another device and verify the same
    status.
-   End the class window and confirm Present remains Present.
-   Use a separate session with no submission and verify the correct
    automatic Absent behavior.
-   Confirm photo, keynote, and timestamp survive reopening if
    applicable.
-   Verify ERP status remains independent.
-   Confirm read/write failures are visible and are not misrepresented
    as an empty record or a successful save.

## 12. Bottom line

The reusable lesson from AssignEase is the **end-to-end persistence and
restoration workflow**: write, confirm, invalidate/refetch, and render
the cloud-retrieved record, with listeners to keep clients synchronized.

The parts that must not be copied blindly are its frontend-only lock,
permissive Firestore rules, non-atomic submission creation, and its
error-to-empty-array behavior.

AttendWise's root cause is not established by this reference report. It
must be demonstrated from AttendWise's own source code and, where
possible, the actual persisted Firestore record.
