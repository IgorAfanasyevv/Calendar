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
  currency?: string; // ISO код валюты этой конкретной покупки, по умолчанию — валюта пространства
  quantity: number;
  bought: boolean;
  createdBy: string;
  createdByName: string;
  createdAt: number;
}

export interface DietPreferences {
  restrictions?: string; // аллергии/диета: веган, без глютена и т.п.
  dislikes?: string; // нелюбимые продукты
  cuisine?: string; // предпочитаемая кухня
  cookingTime?: 'quick' | 'standard' | 'any'; // сколько готовы тратить времени на готовку
}

export interface WorkspaceMember {
  uid: string;
  displayName: string;
  email: string;
  role: 'me' | 'partner';
  calorieGoal?: number;
  proteinGoal?: number;
  fatGoal?: number;
  carbsGoal?: number;
  dietPreferences?: DietPreferences;
  fitnessPreferences?: FitnessPreferences;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface FoodEntry {
  id: string;
  workspaceId: string;
  date: string; // yyyy-mm-dd
  mealType: MealType;
  name: string;
  calories: number;
  grams?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  planned?: boolean; // true = запланировано в меню, ещё не съедено
  ingredients?: string[]; // продукты для этого блюда (из ИИ-меню), для добавления в покупки вручную
  addedToShopping?: boolean;
  recipe?: string; // полный пошаговый рецепт с граммовкой (генерируется ИИ по запросу, кешируется)
  createdBy: string;
  createdByName: string;
  createdAt: number;
}

export interface FoodPreset {
  id: string;
  workspaceId: string;
  name: string;
  calories: number;
  grams?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
}

export type WorkoutType = 'strength' | 'cardio' | 'flexibility' | 'sport' | 'other';

export interface ExerciseSet {
  reps?: number;
  weight?: number; // кг
}

export interface WorkoutExercise {
  name: string;
  sets: ExerciseSet[];
}

export interface WorkoutEntry {
  id: string;
  workspaceId: string;
  date: string;
  name: string;
  type?: WorkoutType;
  durationMinutes: number;
  caloriesBurned?: number;
  exercises?: WorkoutExercise[];
  planned?: boolean;
  note?: string;
  createdBy: string;
  createdByName: string;
  createdAt: number;
}

export interface WorkoutTemplate {
  id: string;
  workspaceId: string;
  name: string;
  type?: WorkoutType;
  exercises: { name: string; targetSets?: number; targetReps?: number }[];
  createdByName: string;
  createdAt: number;
}

export interface BodyMeasurement {
  id: string;
  workspaceId: string;
  uid: string;
  date: string;
  weight?: number; // кг
  bodyFatPct?: number;
  note?: string;
  createdAt: number;
}

export interface FitnessPreferences {
  level?: 'beginner' | 'intermediate' | 'advanced';
  goal?: 'strength' | 'cardio' | 'weight_loss' | 'flexibility' | 'general';
  equipment?: string;
  limitations?: string;
  daysPerWeek?: number;
  sessionMinutes?: number;
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
  shoppingFinanceBoardId?: string; // если задано — покупки с ценой автоматически попадают в эту вкладку финансов
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

export interface Habit {
  id: string;
  workspaceId: string;
  name: string;
  icon: string; // lucide icon name, e.g. 'Droplet', 'BookOpen', 'Dumbbell'
  color: string;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  archived?: boolean;
}

/** Один документ на отметку выполнения привычки в конкретный день конкретным человеком. */
export interface HabitLog {
  id: string;
  workspaceId: string;
  habitId: string;
  date: string; // yyyy-mm-dd
  uid: string;
  createdAt: number;
}

export type Mood = 'great' | 'good' | 'okay' | 'bad' | 'awful';

export interface JournalEntry {
  id: string;
  workspaceId: string;
  date: string; // yyyy-mm-dd
  text: string;
  mood?: Mood;
  isMemory?: boolean; // отметить как особое воспоминание/достижение
  photoUrl?: string;
  createdBy: string;
  createdByName: string;
  createdAt: number;
}

export interface SavingsPot {
  id: string;
  workspaceId: string;
  name: string;
  currency: string;
  targetAmount?: number;
  monthlyContribution?: number;
  balance: number;
  color: string;
  createdByName: string;
  createdAt: number;
}

export interface SavingsTransaction {
  id: string;
  workspaceId: string;
  potId: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  note?: string;
  date: string;
  createdByName: string;
  createdAt: number;
}

export type WatchType = 'movie' | 'series' | 'other';
export type WatchStatus = 'to_watch' | 'watched';

export interface WatchlistItem {
  id: string;
  workspaceId: string;
  title: string;
  type: WatchType;
  status: WatchStatus;
  rating?: number; // 1-5
  note?: string;
  createdBy: string;
  createdByName: string;
  createdAt: number;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  workspaceId?: string;
}
