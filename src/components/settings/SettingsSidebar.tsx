import { cn } from '@/lib/utils';
import type { SettingsGroup } from './types.ts';

interface SettingsSidebarProps {
    groups: SettingsGroup[];
    selected: string;
    onSelect: (id: string) => void;
}

export const SettingsSidebar = ({ groups, selected, onSelect }: SettingsSidebarProps) => {
    return (
        <aside className={cn(
            'w-56 shrink-0 border-r border-border',
            'flex flex-col overflow-y-auto py-4',
            'bg-background'
        )}>
            {groups.map((group, groupIdx) => (
                <div key={groupIdx} className="mb-4">
                    {group.title && (
                        <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {group.title}
                        </p>
                    )}
                    <ul>
                        {group.sections.map((section) => {
                            const Icon = section.icon;
                            const isActive = selected === section.id;
                            return (
                                <li key={section.id}>
                                    <button
                                        type="button"
                                        onClick={() => onSelect(section.id)}
                                        className={cn(
                                            'w-full flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-none',
                                            'transition-colors text-left',
                                            isActive
                                                ? 'bg-accent text-accent-foreground'
                                                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                                        )}
                                    >
                                        <Icon className="h-4 w-4 shrink-0" />
                                        {section.label}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </aside>
    );
};
