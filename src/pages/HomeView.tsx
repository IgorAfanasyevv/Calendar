import { useState } from 'react';
import { ListChecks, CalendarDays, LayoutList } from 'lucide-react';
import TaskListPanel from '../components/TaskListPanel';
import CalendarPanel from '../components/CalendarPanel';
import RightPanel from '../components/RightPanel';
import { useLanguageStore } from '../store/languageStore';

type MobilePane = 'tasks' | 'calendar' | 'overview';

export default function HomeView({ workspaceId }: { workspaceId: string }) {
  const [mobilePane, setMobilePane] = useState<MobilePane>('calendar');
  const { t } = useLanguageStore();

  return (
    <div className="h-full flex flex-col lg:block">
      {/* Переключатель панелей — только на мобильном/планшете, на десктопе всё видно сразу */}
      <div className="lg:hidden flex gap-1.5 p-3 pb-0">
        <MobileTab active={mobilePane === 'tasks'} onClick={() => setMobilePane('tasks')} icon={ListChecks} label={t('home_tab_tasks')} />
        <MobileTab active={mobilePane === 'calendar'} onClick={() => setMobilePane('calendar')} icon={CalendarDays} label={t('home_tab_calendar')} />
        <MobileTab active={mobilePane === 'overview'} onClick={() => setMobilePane('overview')} icon={LayoutList} label={t('home_tab_overview')} />
      </div>

      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[300px_1fr_280px] lg:h-screen">
        <div
          className={`border-r border-neutral-200/60 dark:border-neutral-800 lg:h-screen overflow-hidden h-full ${
            mobilePane === 'tasks' ? 'block' : 'hidden'
          } lg:block`}
        >
          <TaskListPanel workspaceId={workspaceId} />
        </div>
        <div
          className={`lg:h-screen overflow-hidden h-full ${mobilePane === 'calendar' ? 'block' : 'hidden'} lg:block`}
        >
          <CalendarPanel workspaceId={workspaceId} />
        </div>
        <div
          className={`border-l border-neutral-200/60 dark:border-neutral-800 lg:h-screen overflow-hidden h-full ${
            mobilePane === 'overview' ? 'block' : 'hidden'
          } lg:block`}
        >
          <RightPanel />
        </div>
      </div>
    </div>
  );
}

function MobileTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof ListChecks;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition ${
        active ? 'bg-indigo-500 text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
