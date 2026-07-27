import { useEffect, useState } from 'react';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from './lib/firebase';
import { useAuthStore } from './store/authStore';
import { useWorkspaceStore } from './store/workspaceStore';
import { useTaskStore } from './store/taskStore';
import { useGoalStore } from './store/goalStore';
import { useShoppingStore } from './store/shoppingStore';
import { useActivityStore } from './store/activityStore';
import AuthPage from './pages/AuthPage';
import WorkspaceSetupPage from './pages/WorkspaceSetupPage';
import Layout, { type Tab } from './components/Layout';
import HomeView from './pages/HomeView';
import GoalsView from './pages/GoalsView';
import ShoppingView from './pages/ShoppingView';
import FinanceView from './pages/FinanceView';
import FitnessView from './pages/FitnessView';
import ImportantDatesView from './pages/ImportantDatesView';
import SettingsView from './pages/SettingsView';
import GlobalAssistant from './components/GlobalAssistant';
import { useImportantDateStore } from './store/importantDateStore';
import { Loader2, Heart } from 'lucide-react';

export default function App() {
  const { firebaseUser, profile, loading, error } = useAuthStore();
  const { workspace, listen: listenWorkspace } = useWorkspaceStore();
  const { listen: listenTasks } = useTaskStore();
  const { listen: listenGoals } = useGoalStore();
  const { listen: listenShopping } = useShoppingStore();
  const { listen: listenActivity } = useActivityStore();
  const { listen: listenDates } = useImportantDateStore();
  const [tab, setTab] = useState<Tab>('home');

  useEffect(() => {
    if (!profile?.workspaceId) return;
    const unsub = listenWorkspace(profile.workspaceId);
    return unsub;
  }, [profile?.workspaceId, listenWorkspace]);

  // Если владелец удалил этого пользователя из пространства — его uid больше
  // не входит в memberUids. Сбрасываем локальную привязку к пространству,
  // чтобы человек вернулся на экран "создать/подключиться по коду".
  useEffect(() => {
    if (!workspace || !firebaseUser || !profile?.workspaceId) return;
    if (workspace.id !== profile.workspaceId) return;
    if (!workspace.memberUids.includes(firebaseUser.uid)) {
      useWorkspaceStore.setState({ workspace: null });
      updateDoc(doc(db, 'users', firebaseUser.uid), { workspaceId: deleteField() }).catch(() => {});
    }
  }, [workspace, firebaseUser, profile?.workspaceId]);

  useEffect(() => {
    if (!workspace?.id) return;
    const unsubTasks = listenTasks(workspace.id);
    const unsubGoals = listenGoals(workspace.id);
    const unsubShopping = listenShopping(workspace.id);
    const unsubActivity = listenActivity(workspace.id);
    const unsubDates = listenDates(workspace.id);
    return () => {
      unsubTasks();
      unsubGoals();
      unsubShopping();
      unsubActivity();
      unsubDates();
    };
  }, [workspace?.id, listenTasks, listenGoals, listenShopping, listenActivity, listenDates]);

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
            Проверьте .env (ключи Firebase) и что правила Firestore загружены командой{' '}
            <code className="bg-neutral-100 dark:bg-neutral-800 px-1 rounded">npm run deploy:rules</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !profile) return <AuthPage />;
  if (!profile.workspaceId) return <WorkspaceSetupPage />;
  if (!workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }

  return (
    <>
      <Layout tab={tab} onTabChange={setTab}>
        {tab === 'home' && <HomeView workspaceId={workspace.id} />}
        {tab === 'goals' && <GoalsView workspaceId={workspace.id} />}
        {tab === 'shopping' && <ShoppingView workspaceId={workspace.id} />}
        {tab === 'finance' && <FinanceView workspaceId={workspace.id} />}
        {tab === 'fitness' && <FitnessView workspaceId={workspace.id} />}
        {tab === 'dates' && <ImportantDatesView workspaceId={workspace.id} />}
        {tab === 'settings' && <SettingsView />}
      </Layout>
      <GlobalAssistant />
    </>
  );
}
