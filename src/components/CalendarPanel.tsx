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
import { computeDueAtUtc, effectiveDate, localDateStr, localTimeStr } from '../lib/timezone';
import { isGradientColor, solidFallback } from '../lib/taskColor';

export default function CalendarPanel({ workspaceId }: { workspaceId: string }) {
  const { tasks, updateTask } = useTaskStore();
  const { firebaseUser, profile } = useAuthStore();
  const [editing, setEditing] = useState<Task | undefined>(undefined);
  const [dayView, setDayView] = useState<{ date: string; tasks: Task[] } | undefined>(undefined);
  const [creatingForDate, setCreatingForDate] = useState<string | undefined>(undefined);

  const actor = { uid: firebaseUser?.uid || '', name: profile?.displayName || '' };

  // Задачи, сгруппированные по дате В ЧАСОВОМ ПОЯСЕ ТЕКУЩЕГО ЗРИТЕЛЯ —
  // используется и для подсветки клеток, и для клика по дню.
  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    tasks.forEach((t) => {
      const d = effectiveDate(t);
      if (!d) return;
      map[d] = map[d] || [];
      map[d].push(t);
    });
    return map;
  }, [tasks]);

  const events = useMemo(
    () =>
      tasks
        .filter((t) => t.date)
        .map((t) => {
          // Если известен точный момент (dueAtUtc) — используем его: FullCalendar
          // сам отрисует его в локальном часовом поясе браузера зрителя.
          // Если времени нет (только дата) — это событие "на весь день",
          // часовой пояс тут ни при чём.
          const start = t.dueAtUtc ? new Date(t.dueAtUtc) : t.date!;
          const end =
            t.dueAtUtc && t.durationMinutes ? new Date(t.dueAtUtc + t.durationMinutes * 60000) : undefined;
          return {
            id: t.id,
            title: t.title,
            start,
            end,
            allDay: !t.dueAtUtc,
            backgroundColor: solidFallback(t.color),
            borderColor: solidFallback(t.color),
            textColor: '#fff',
            classNames: t.done ? ['opacity-50'] : [],
            extendedProps: { isGradient: isGradientColor(t.color) },
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
    const date = localDateStr(start.getTime());
    const time = arg.event.allDay ? undefined : localTimeStr(start.getTime());
    await updateTask(
      task.id,
      {
        date,
        time,
        dueAtUtc: time ? computeDueAtUtc(date, time) : undefined,
      },
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
    const dateStr = localDateStr(arg.date.getTime());
    const dayTasks = tasksByDate[dateStr];
    const frame = arg.el.querySelector<HTMLElement>('.fc-daygrid-day-frame') || arg.el;
    // Клетка кликабельна всегда (создание задачи или просмотр списка), курсор ставим в любом случае
    frame.style.cursor = 'pointer';
    if (!dayTasks || dayTasks.length === 0) return;

    const colors = Array.from(new Set(dayTasks.map((t) => solidFallback(t.color))));

    if (colors.length === 1) {
      frame.style.backgroundColor = hexToRgba(colors[0], 0.14);
    } else {
      const stops = colors.map((c, i) => `${hexToRgba(c, 0.16)} ${(i / colors.length) * 100}%, ${hexToRgba(c, 0.16)} ${((i + 1) / colors.length) * 100}%`);
      frame.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
    }
    frame.style.borderRadius = '10px';
  }

  function handleEventDidMount(arg: { event: { extendedProps: Record<string, unknown> }; el: HTMLElement }) {
    if (arg.event.extendedProps.isGradient) {
      arg.el.style.backgroundImage = 'linear-gradient(135deg, #6366f1, #fb7185)';
      arg.el.style.backgroundColor = 'transparent';
      arg.el.style.borderColor = 'transparent';
    }
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
    <div className="h-full p-2 sm:p-4">
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
        eventDisplay="block"
        dayMaxEventRows={3}
        moreLinkText={(n) => `+ ещё ${n}`}
        eventClick={handleEventClick}
        eventDrop={handleDrop}
        eventResize={handleResize}
        eventDidMount={handleEventDidMount}
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
