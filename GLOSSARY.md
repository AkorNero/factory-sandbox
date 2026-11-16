# Day Planner

A single-person planner focused on the work of the current day, while still letting you plan ahead without facing the whole calendar.

## Language

### Things you plan

**Task**:
Something to do and tick off. It can stand alone or be done inside an Event.
_Avoid_: To-do, item, chore

**Sub-task**:
A smaller step that belongs to exactly one Task and can be ticked off on its own. Sub-tasks never have Sub-tasks.
_Avoid_: Checklist item, step

**Someday**:
The set of Tasks with no date. They stay out of Today and Upcoming.
_Avoid_: Inbox, backlog, undated

**Event**:
A time slot on the calendar with a start and an end. It can exist without any Tasks.
_Avoid_: Appointment, meeting, block

**Placement**:
The link that puts a Task or a Sub-task into one Event, as the plan for when it gets done. A Task that has Sub-tasks is never placed itself; only its Sub-tasks are.
_Avoid_: Scheduling, booking, assignment, slotting

**Unplaced**:
A Task or Sub-task that has no Placement.
_Avoid_: Floating, unscheduled

**Completion time**:
The moment a Task or Sub-task was ticked off. It can be edited afterwards. The Event it was done in is the Event it was placed in, if that Event covers this moment. Otherwise it is the Event that covers this moment, and if several overlap, the one that started most recently. It can also be none.
_Avoid_: Done-at, log, timestamp

### Views

**Today**:
The main view: only the current day's Tasks and Events. It shows what is on now and next, the day's unplaced Tasks, what is done, and the rest of the day.
_Avoid_: Dashboard, home, agenda

**Upcoming**:
The next 7 days, shown as a strip of days above Today. Each day holds its Events and dated Tasks, including recurring ones. Any later day can be opened on request.
_Avoid_: Calendar, schedule, future view

### Repetition

**Carry-over**:
An unfinished dated Task or Sub-task moving forward to the next day on its own at the end of the day. It loses its Placement on the way.
_Avoid_: Rollover, postpone

**Recurrence**:
A rule that makes a Task or an Event repeat on its own on a fixed schedule: every N days, on chosen weekdays, or on a day of the month. Sub-tasks never recur on their own; they come with their Task.
_Avoid_: Repeat, schedule

**Occurrence**:
One Task or Event made by a Recurrence, on one day. It can be ticked off, placed, moved, changed and deleted like any other Task or Event, even before its day arrives, and it stays linked to its Recurrence afterwards. A change to it applies either to just this one or to this and the following Occurrences; Occurrences on earlier days, done or Skipped are never changed. An Occurrence of an Event never brings Placements with it.
_Avoid_: Instance, repeat, copy

**Skipped**:
An Occurrence of a Task left unfinished when the next Occurrence arrives. It is closed without being done, and so are its unfinished Sub-tasks. It is kept as a record, unlike a deleted Occurrence, which leaves no trace.
_Avoid_: Missed, expired

**Routine**:
A saved bundle of Events, Tasks, Sub-tasks and the Placements between them, which you add to a day by hand whenever you choose. Adding it makes fresh copies with no link back to the Routine. It is separate from Recurrence: nothing about it happens on its own.
_Avoid_: Template, preset
