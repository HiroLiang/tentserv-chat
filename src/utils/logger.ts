import { env } from "@/config/env.ts";
import { invoke, isTauri } from "@tauri-apps/api/core";

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_MAP: Record<LogLevel, number> = {
    trace: 1,
    debug: 2,
    info: 3,
    warn: 4,
    error: 5,
};

interface Logger {
    trace(message: string, data?: unknown): void;

    debug(message: string, data?: unknown): void;

    info(message: string, data?: unknown): void;

    warn(message: string, data?: unknown): void;

    error(message: string, data?: unknown): void;
}

class BrowserLogger implements Logger {
    private getCaller(): string {
        const error = new Error();
        const stack = error.stack?.split('\n').map(s => s.trim()) ?? [];
        const callerLine = stack[3] ?? '';

        // 1) Chromium: at func (http://.../file.ts:line:col)
        // 2) Chromium: at http://.../file.ts:line:col
        // 3) Firefox: func@http://.../file.ts:line:col
        const m =
            callerLine.match(/\((.*):(\d+):(\d+)\)$/) ||
            callerLine.match(/at (.*):(\d+):(\d+)$/) ||
            callerLine.match(/@(.*):(\d+):(\d+)$/);

        if (!m) return 'unknown';

        const [, file, line] = m;
        const cleanFile = file.split('?')[0];
        const fileName = cleanFile.split('/').pop() ?? cleanFile;

        return `${fileName}:${line}`;
    }

    trace(message: string, data?: unknown) {
        if (!env.IS_DEV) return;
        const caller = this.getCaller();
        data !== undefined
            ? console.debug(`[TRACE][${caller}] ${message}`, data)
            : console.debug(`[TRACE][${caller}] ${message}`);
    }

    debug(message: string, data?: unknown) {
        if (!env.IS_DEV) return;
        const caller = this.getCaller();
        data !== undefined
            ? console.debug(`[DEBUG][${caller}] ${message}`, data)
            : console.debug(`[DEBUG][${caller}] ${message}`);
    }

    info(message: string, data?: unknown) {
        if (!env.IS_DEV) return;
        const caller = this.getCaller();
        data !== undefined
            ? console.log(`[INFO][${caller}] ${message}`, data)
            : console.log(`[INFO][${caller}] ${message}`);
    }

    warn(message: string, data?: unknown) {
        const caller = this.getCaller();
        data !== undefined
            ? console.warn(`[WARN][${caller}] ${message}`, data)
            : console.warn(`[WARN][${caller}] ${message}`);
    }

    error(message: string, data?: unknown) {
        const caller = this.getCaller();
        data !== undefined
            ? console.error(`[ERROR][${caller}] ${message}`, data)
            : console.error(`[ERROR][${caller}] ${message}`);
    }
}

class TauriLogger implements Logger {
    private getCaller(): string {
        const error = new Error();
        const stack = error.stack?.split('\n');
        if (!stack || stack.length < 4) return 'unknown';

        const callerLine = stack[3];
        if (callerLine) {
            const match = callerLine.match(/@(.+):(\d+):(\d+)$/);
            if (match) {
                const [, file, line] = match;
                const fileName = file.split('/').pop();
                return `${fileName}:${line}`;
            }
        }
        return 'unknown';
    }

    private formatData(data?: unknown): string {
        if (data === undefined) return '';
        if (data instanceof Error) return ` | ${data.message}\n${data.stack ?? ''}`;
        try {
            return ` | ${JSON.stringify(data)}`;
        } catch {
            return ` | ${String(data)}`;
        }
    }

    private log(level: LogLevel, message: string, data?: unknown) {
        const caller = this.getCaller();
        const formatted = `[${caller}] ${message}${this.formatData(data)}`;

        invoke('plugin:log|log', {
            level: LOG_LEVEL_MAP[level],
            message: formatted,
            target: caller,
        }).catch((err) => {
            console.error('[TauriLogger] invoke failed', err);
        });
    }

    trace(message: string, data?: unknown) {
        this.log('trace', message, data);
    }

    debug(message: string, data?: unknown) {
        this.log('debug', message, data);
    }

    info(message: string, data?: unknown) {
        this.log('info', message, data);
    }

    warn(message: string, data?: unknown) {
        this.log('warn', message, data);
    }

    error(message: string, data?: unknown) {
        this.log('error', message, data);
    }
}

const createLogger = (): Logger => {
    return isTauri() ? new TauriLogger() : new BrowserLogger();
}

export const logger: Logger = createLogger();