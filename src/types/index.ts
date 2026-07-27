export type Assignee = 'me' | 'partner' | 'together';

export type Priority = 'low' | 'medium' | 'high';

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  date?: string; // ISO date (yyyy-mm-dd) - как ввёл создатель задачи, в его часовом поясе
  time?: string; // HH:mm - как ввёл создатель задачи, в его часовом поясе
  dueAtUtc?: number; // точный момент времени (epoch ms), не зависит от часового пояса — используется для отображения и напоминаний
  durationMinutes?: number;
  color: string;
  category: string;
  location?: string;
  priority: Priority;
  repeat: 'none' | 'daily' | 'weekly' | 'monthly';
  assignee: Assignee;
  done: boolean;
  checklist: ChecklistItem[];
  goalId?: string;
  reminder1DaySent?: boolean;
  reminder1HourSent?: boolean;
  createdBy: string;
  createdByName: string;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: number;
  createdAt: number;
}

export interface Goal {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  deadline?: string;
  progress: number; // 0-100
  steps: ChecklistItem[];
  createdAt: number;
  createdByName: string;
}

export interface ShoppingItem {
  id: string;
  workspaceId: string;
  name: string;
  category: string;
  price?: number;
  quantity: number;
  bought: boolean;
  createdAt: number;
}

export interface WorkspaceMember {
  uid: string;
  displayName: string;
  email: string;
  role: 'me' | 'partner';
  calorieGoal?: number;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface FoodEntry {
  id: string;
  workspaceId: string;
  date: string; // yyyy-mm-dd
  mealType: MealType;
  name: string;
  calories: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  planned?: boolean; // true = запланировано в меню, ещё не съедено
  createdBy: string;
  createdByName: string;
  createdAt: number;
}

export interface FoodPreset {
  id: string;
  workspaceId: string;
  name: string;
  calories: number;
  protein?: number;
  fat?: number;
  carbs?: number;
}

export interface WorkoutEntry {
  id: string;
  workspaceId: string;
  date: string;
  name: string;
  durationMinutes: number;
  caloriesBurned?: number;
  note?: string;
  createdBy: string;
  createdByName: string;
  createdAt: number;
}

export type FinanceType = 'income' | 'expense';

export interface FinanceEntry {
  id: string;
  workspaceId: string;
  boardId: string;
  type: FinanceType;
  amount: number;
  category: string;
  note?: string;
  date: string; // yyyy-mm-dd
  planned?: boolean; // true = запланированная будущая трата, ещё не оплачена
  paidAmount?: number; // сколько уже оплачено частями от запланированной суммы
  createdAt: number;
  createdByName: string;
}

export interface FinanceBoard {
  id: string;
  workspaceId: string;
  name: string;
  currency: string;
  monthlyBudget?: number;
  expenseCategories: string[];
  incomeCategories: string[];
  createdAt: number;
  createdByName: string;
}

export interface Workspace {
  id: string;
  name: string;
  inviteCode: string;
  ownerUid: string;
  members: WorkspaceMember[];
  memberUids: string[];
  monthlyBudget?: number;
  currency?: string; // ISO code, e.g. 'RUB', 'USD', 'EUR'
  createdAt: number;
}

export interface ActivityEntry {
  id: string;
  workspaceId: string;
  message: string;
  actorUid: string;
  actorName: string;
  readBy: string[];
  createdAt: number;
}

export type DateKind = 'birthday' | 'anniversary' | 'holiday' | 'other';

export interface ImportantDate {
  id: string;
  workspaceId: string;
  title: string;
  date: string; // yyyy-mm-dd — исходная дата (год используется для подсчёта "N лет вместе")
  kind: DateKind;
  note?: string;
  reminderDaysBefore?: number; // за сколько дней напомнить, по умолчанию 7
  remindedYear?: number; // последний год, за который уже отправили письмо-напоминание
  createdByName: string;
  createdAt: number;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  workspaceId?: string;
}
