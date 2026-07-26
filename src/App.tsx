import { useEffect, useState } from 'react';
import { useAuthStore } from './store/authStore';
import { useWorkspaceStore } from './store/workspaceStore';
import { useTaskStore } from './store/taskStore';
import { useGoalStore } from './store/goalStore';
import { useShoppingStore } from './store/shoppingStore';
import NameSetupPage from './pages/NameSetupPage';
import WorkspaceSetupPage from './pages/WorkspaceSetupPage';
import Layout, { type Tab } from './components/Layout';
import HomeView from './pages/HomeView';
import GoalsView from './pages/GoalsView';
import ShoppingView from './pages/ShoppingView';
import SettingsView from './pages/SettingsView';
import { Loader2, Heart } from 'lucide-react';

export default function App() {
  const { firebaseUser, profile, loading, error } = useAuthStore();
  const { workspace, listen: listenWorkspace } = useWorkspaceStore();
  const { listen: listenTasks } = useTaskStore();
  const { listen: listenGoals } = useGoalStore();
  const { listen: listenShopping } = useShoppingStore();
  const [tab, setTab] = useState<Tab>('home');

  useEffect(() => {
    if (!profile?.workspaceId) return;
    const unsub = listenWorkspace(profile.workspaceId);
    return unsub;
  }, [profile?.workspaceId, listenWorkspace]);

  useEffect(() => {
    if (!workspace?.id) return;
    const unsubTasks = listenTasks(workspace.id);
    const unsubGoals = listenGoals(workspace.id);
    const unsubShopping = listenShopping(workspace.id);
    return () => {
      unsubTasks();
      unsubGoals();
      unsubShopping();
    };
  }, [workspace?.id, listenTasks, listenGoals, listenShopping]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-neutral-400">
        <Heart size={28} className="text-rose-400" />
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm text-center space-y-3">
          <p className="text-rose-500 text-sm font-medium">{error}</p>
          <p className="text-xs text-neutral-400">
            Проверьте .env (ключи Firebase), что включён провайдер "Anonymous" в Firebase
            Authentication, и что правила Firestore загружены командой{' '}
            <code className="bg-neutral-100 dark:bg-neutral-800 px-1 rounded">npm run deploy:rules</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !profile) return <NameSetupPage />;
  if (!profile.workspaceId) return <WorkspaceSetupPage />;
  if (!workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }

  return (
    <Layout tab={tab} onTabChange={setTab}>
      {tab === 'home' && <HomeView workspaceId={workspace.id} />}
      {tab === 'goals' && <GoalsView workspaceId={workspace.id} />}
      {tab === 'shopping' && <ShoppingView workspaceId={workspace.id} />}
      {tab === 'settings' && <SettingsView />}
    </Layout>
  );
}
