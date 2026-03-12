import type { LucideIcon } from 'lucide-react';
import type { User } from '@/types/user.ts';

export interface SettingsContext {
    user: User | null;
    // 未來可擴充：hasChatIdentity?: boolean; isVerified?: boolean; etc.
}

export interface SettingsSection {
    id: string;
    label: string;
    icon: LucideIcon;
    component: React.ComponentType;
    /** 若 undefined，永遠顯示；回傳 false 則隱藏此 section */
    condition?: (ctx: SettingsContext) => boolean;
}

export interface SettingsGroup {
    title?: string;
    sections: SettingsSection[];
}
