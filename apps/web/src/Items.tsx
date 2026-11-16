import type { ItemView } from '@dayplanner/core';
import { useState, type FormEvent } from 'react';
import { useDrag } from './drag.tsx';

/** Pieces shared by Anytime, Done today and the Event cards. No rules in here. */

export interface ItemActions {
  onTick: (item: ItemView) => void;
  onOpen: (id: string) => void;
}

/** The recurrence tag: a bare ↻, or in full ("↻ daily") where there is room: rows, and the pills of a later day. */
export function Recurrence({ recurrence, full }: { recurrence: string | null; full?: boolean }) {
  if (recurrence === null) return null;
  return (
    <span className="rtag" title={`repeats ${recurrence}`}>
      {full ? `↻ ${recurrence}` : '↻'}
    </span>
  );
}

export const label = (i: ItemView) => (i.parentTitle ? `${i.parentTitle} › ${i.title}` : i.title);

/** `09:40 · Deep work`, or just the time when it was done outside every Event. */
const doneNote = (i: ItemView) => (i.completedTime ? [i.completedTime, i.doneIn].filter(Boolean).join(' · ') : null);

/** `2/3`: how many Sub-tasks of a Task are done. */
const Progress = ({ item }: { item: ItemView }) =>
  item.subtasks ? (
    <span className="badge" aria-label={`${item.subtasks.done} of ${item.subtasks.total} Sub-tasks done`}>
      {item.subtasks.done}/{item.subtasks.total}
    </span>
  ) : null;

/**
 * The item's label, opening its tap menu. A Sub-task reads "Parent › Sub-task" and the "Parent ›" part opens the
 * parent's own menu: a Task with Sub-tasks is listed on no day, so this is how it is reached (rename, delete, Repeat…).
 */
function Label({ item, onOpen }: { item: ItemView; onOpen: ItemActions['onOpen'] }) {
  if (!item.parentId) {
    return (
      <button type="button" className="label" aria-haspopup="dialog" onClick={() => onOpen(item.id)}>
        {item.title}
      </button>
    );
  }
  return (
    <span className="labels">
      <button type="button" className="label parent-link" aria-haspopup="dialog" aria-label={`Open ${item.parentTitle}`} onClick={() => onOpen(item.parentId!)}>
        {item.parentTitle} ›
      </button>{' '}
      <button type="button" className="label" aria-haspopup="dialog" aria-label={label(item)} onClick={() => onOpen(item.id)}>
        {item.title}
      </button>
    </span>
  );
}

function Tick({ item, onTick }: { item: ItemView; onTick: ItemActions['onTick'] }) {
  const isDone = item.completedTime !== null;
  return (
    <button
      type="button"
      data-tick
      className={`tick ${isDone ? 'on' : ''} ${item.subtasks ? 'parent' : ''}`}
      aria-label={`${isDone ? 'Untick' : 'Tick off'} ${label(item)}`}
      onClick={() => onTick(item)}
    >
      {isDone && '✓'}
    </button>
  );
}

/** One pill: the round tick toggles done, the label opens the tap menu. An open one can be dragged. */
export function Pill({ item, onTick, onOpen, fullTag }: { item: ItemView; fullTag?: boolean } & ItemActions) {
  const isDone = item.completedTime !== null;
  const drag = useDrag().dragProps({ id: item.id, label: label(item) });
  return (
    <li className={`pill ${item.carriedOver ? 'carried' : ''} ${isDone ? 'done' : ''}`} {...(isDone ? {} : drag)}>
      <Tick item={item} onTick={onTick} />
      <Label item={item} onOpen={onOpen} />
      {item.carriedOver && <span className="badge warn">↪</span>}
      <Recurrence recurrence={item.recurrence} full={fullTag} />
      <Progress item={item} />
      {isDone && <small className="mute">{doneNote(item)}</small>}
    </li>
  );
}

/** A Task placed in an Event, as a row inside the Event's card. */
export function TaskRow({ item, onTick, onOpen }: { item: ItemView } & ItemActions) {
  const isDone = item.completedTime !== null;
  const drag = useDrag().dragProps({ id: item.id, label: label(item) });
  return (
    <li className={`task-row ${isDone ? 'done' : ''}`} {...(isDone ? {} : drag)}>
      <Tick item={item} onTick={onTick} />
      <Label item={item} onOpen={onOpen} />
      <Recurrence recurrence={item.recurrence} full />
      <Progress item={item} />
      {isDone && <small className="mute">{doneNote(item)}</small>}
    </li>
  );
}

export function TaskRows({ items, ...actions }: { items: ItemView[] } & ItemActions) {
  if (items.length === 0) return null;
  return (
    <ul className="task-rows">
      {items.map((i) => (
        <TaskRow key={i.id} item={i} {...actions} />
      ))}
    </ul>
  );
}

/** A dashed "+ …" field: Enter adds, and the field keeps focus for the next one. */
export function AddField({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = text.trim();
    if (!title) return;
    setText('');
    await onAdd(title);
  };
  return (
    <form onSubmit={submit}>
      <input className="add" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}
