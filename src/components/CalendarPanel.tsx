import { useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventClickArg, EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { useTaskStore } from '../store/taskStore';
import { useAuthStore } from '../store/authStore';
import type { Task } from '../types';
import TaskModal from './TaskModal';

export default function CalendarPanel({ workspaceId }: { workspaceId: string }) {
  const { tasks, updateTask } = useTaskStore();
  const { firebaseUser, profile } = useAuthStore();
  const [editing, setEditing] = useState<Task | undefined>(undefined);

  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };

  const events = useMemo(
    () =>
      tasks
        .filter((t) => t.date)
        .map((t) => {
          const start = t.time ? `${t.date}T${t.time}` : t.date!;
          const end =
            t.time && t.durationMinutes
              ? addMinutes(`${t.date}T${t.time}`, t.durationMinutes)
              : undefined;
          return {
            id: t.id,
            title: t.title,
            start,
            end,
            allDay: !t.time,
            backgroundColor: t.color,
            borderColor: t.color,
            textColor: '#fff',
            classNames: t.done ? ['opacity-50'] : [],
          };
        }),
    [tasks]
  );

  function handleEventClick(arg: EventClickArg) {
    const task = tasks.find((t) => t.id === arg.event.id);
    if (task) setEditing(task);
  }

  async function handleDrop(arg: EventDropArg) {
    const task = tasks.find((t) => t.id === arg.event.id);
    if (!task) return;
    const start = arg.event.start!;
    await updateTask(
      task.id,
      { date: toDateStr(start), time: arg.event.allDay ? undefined : toTimeStr(start) },
      actor
    );
  }

  async function handleResize(arg: EventResizeDoneArg) {
    const task = tasks.find((t) => t.id === arg.event.id);
    if (!task || !arg.event.start || !arg.event.end) return;
    const minutes = Math.round((arg.event.end.getTime() - arg.event.start.getTime()) / 60000);
    await updateTask(task.id, { durationMinutes: minutes }, actor);
  }

  return (
    <div className="h-full p-4">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay',
        }}
        buttonText={{ today: 'Сегодня', month: 'Месяц', week: 'Неделя', day: 'День' }}
        locale="ru"
        firstDay={1}
        height="100%"
        editable
        droppable
        eventResizableFromStart
        events={events}
        eventClick={handleEventClick}
        eventDrop={handleDrop}
        eventResize={handleResize}
      />
      {editing && <TaskModal workspaceId={workspaceId} initial={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function addMinutes(dt: string, minutes: number): string {
  const d = new Date(dt);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().slice(0, 19);
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toTimeStr(d: Date): string {
  return d.toTimeString().slice(0, 5);
}
