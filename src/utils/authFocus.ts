import { useDeviceStore } from "@/stores/deviceStore.ts";

let authFocusInteractionSeen = false;

function isMacOsPlatform(): boolean {
    const platform = useDeviceStore.getState().platform;
    if (platform) {
        return platform === "macos";
    }

    if (typeof navigator === "undefined") {
        return false;
    }

    return /mac/i.test(navigator.userAgent) || /mac/i.test(navigator.platform ?? "");
}

export function noteAuthFocusInteraction(): void {
    authFocusInteractionSeen = true;
}

export function resetAuthFocusInteraction(): void {
    authFocusInteractionSeen = false;
}

export function canProgrammaticallyFocusAuthField(options?: {
    requireUserInteraction?: boolean;
}): boolean {
    if (!isMacOsPlatform()) {
        return true;
    }

    return options?.requireUserInteraction === true && authFocusInteractionSeen;
}

export function focusAuthField(
    element: (HTMLElement & { focus: () => void }) | { focus: () => void } | null | undefined,
    options?: {
        requireUserInteraction?: boolean;
    },
): boolean {
    if (!element || !canProgrammaticallyFocusAuthField(options)) {
        return false;
    }

    if (typeof document !== "undefined") {
        const activeElement = document.activeElement as HTMLElement | null;
        const hasExistingFocusableTarget = activeElement
            && activeElement !== document.body
            && activeElement !== document.documentElement
            && activeElement !== element;

        if (hasExistingFocusableTarget) {
            return false;
        }
    }

    element.focus();
    return true;
}
