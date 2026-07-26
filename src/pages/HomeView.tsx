import TaskListPanel from '../components/TaskListPanel';
import CalendarPanel from '../components/CalendarPanel';
import RightPanel from '../components/RightPanel';

export default function HomeView({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_280px] h-screen">
      <div className="border-r border-neutral-200/60 dark:border-neutral-800 lg:h-screen overflow-hidden">
        <TaskListPanel workspaceId={workspaceId} />
      </div>
      <div className="lg:h-screen overflow-hidden">
        <CalendarPanel workspaceId={workspaceId} />
      </div>
      <div className="border-l border-neutral-200/60 dark:border-neutral-800 lg:h-screen overflow-hidden hidden lg:block">
        <RightPanel />
      </div>
    </div>
  );
}
