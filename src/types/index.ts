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
  date?: string; // ISO date (yyyy-mm-dd)
  time?: string; // HH:mm
  durationMinutes?: number;
  color: string;
  category: string;
  location?: string;
  priority: Priority;
  repeat: 'none' | 'daily' | 'weekly' | 'monthly';
  assignee: Assignee;
  done: boolean;
  checklist: ChecklistItem[];
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
  role: 'me' | 'partner';
}

export type FinanceType = 'income' | 'expense';

export interface FinanceEntry {
  id: string;
  workspaceId: string;
  type: FinanceType;
  amount: number;
  category: string;
  note?: string;
  date: string; // yyyy-mm-dd
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
  createdAt: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  workspaceId?: string;
}
