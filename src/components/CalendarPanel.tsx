import { useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventClickArg, EventDropArg, DayCellMountArg } from '@fullcalendar/core';
import type { EventResizeDoneArg, DateClickArg } from '@fullcalendar/interaction';
import { useTaskStore } from '../store/taskStore';
import { useAuthStore } from '../store/authStore';
import type { Task } from '../types';
import TaskModal from './TaskModal';
import DayTasksModal from './DayTasksModal';

export default function CalendarPanel({ workspaceId }: { workspaceId: string }) {
  const { tasks, updateTask } = useTaskStore();
  const { firebaseUser, profile } = useAuthStore();
  const [editing, setEditing] = useState<Task | undefined>(undefined);
  const [dayView, setDayView] = useState<{ date: string; tasks: Task[] } | undefined>(undefined);
  const [creatingForDate, setCreatingForDate] = useState<string | undefined>(undefined);

  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };

  // Задачи, сгруппированные по дате — используется и для подсветки клеток, и для клика по дню
  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    tasks.forEach((t) => {
      if (!t.date) return;
      map[t.date] = map[t.date] || [];
      map[t.date].push(t);
    });
    return map;
  }, [tasks]);

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

  // Подсвечиваем саму клетку дня цветом задачи (или градиентом, если задач несколько)
  function handleDayCellMount(arg: DayCellMountArg) {
    const dateStr = toDateStr(arg.date);
    const dayTasks = tasksByDate[dateStr];
    if (!dayTasks || dayTasks.length === 0) return;

    const colors = Array.from(new Set(dayTasks.map((t) => t.color)));
    const frame = arg.el.querySelector<HTMLElement>('.fc-daygrid-day-frame') || arg.el;

    if (colors.length === 1) {
      frame.style.backgroundColor = hexToRgba(colors[0], 0.14);
    } else {
      const stops = colors.map((c, i) => `${hexToRgba(c, 0.16)} ${(i / colors.length) * 100}%, ${hexToRgba(c, 0.16)} ${((i + 1) / colors.length) * 100}%`);
      frame.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
    }
    frame.style.borderRadius = '10px';
    frame.style.cursor = 'pointer';
  }

  // Клик по клетке дня (не по самой задаче) — показать список задач на этот день,
  // а если задач нет — сразу предложить создать новую именно на эту дату
  function handleDateClick(arg: DateClickArg) {
    const dateStr = arg.dateStr.slice(0, 10);
    const dayTasks = tasksByDate[dateStr] || [];
    if (dayTasks.length > 0) {
      setDayView({ date: dateStr, tasks: dayTasks });
    } else {
      setCreatingForDate(dateStr);
    }
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
        dayCellDidMount={handleDayCellMount}
        dateClick={handleDateClick}
      />
      {editing && <TaskModal workspaceId={workspaceId} initial={editing} onClose={() => setEditing(undefined)} />}
      {creatingForDate && (
        <TaskModal
          workspaceId={workspaceId}
          prefillDate={creatingForDate}
          onClose={() => setCreatingForDate(undefined)}
        />
      )}
      {dayView && (
        <DayTasksModal
          date={dayView.date}
          tasks={dayView.tasks}
          onSelectTask={(t) => {
            setDayView(undefined);
            setEditing(t);
          }}
          onAddNew={() => {
            const d = dayView.date;
            setDayView(undefined);
            setCreatingForDate(d);
          }}
          onClose={() => setDayView(undefined)}
        />
      )}
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
