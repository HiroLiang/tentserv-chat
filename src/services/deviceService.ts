import { DeviceInfo, DeviceRegistrationRequest } from "@/types/device.ts";
import { DeviceRegisterResponse, DeviceUpdateRequest, DeviceUpdateResponse } from "@/api/types.ts";
import { isTauri } from "@tauri-apps/api/core";
import { getDeviceInfo as bridgeGetDeviceInfo, updateDeviceRegistration, clearDeviceId } from "@/bridge/device.ts";
import { logger } from "@/utils/logger.ts";
import { deviceApi } from "@/api/index.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";

class DeviceService {

    /**
     * [EN] Initializes the desktop device before auth/session startup continues.
     *      Tauri creates the local UUID only once, the backend upserts the record,
     *      and the persisted backend response becomes the frontend store state.
     * [中] 在驗證/Session 啟動前初始化桌面裝置。Tauri 只會建立一次本地 UUID，
     *      後端負責 upsert，並以前端收到的後端持久化結果更新 store。
     * [日] 認証/セッション起動の前にデスクトップ端末を初期化する。
     *      Tauri はローカル UUID を一度だけ生成し、バックエンドは upsert し、
     *      永続化済みのレスポンスを frontend store に反映する。
     */
    async initializeDevice(): Promise<void> {
        const info = await bridgeGetDeviceInfo();

        try {
            const response = await this.registerWithBackend(info);
            useDeviceStore.getState().updateDeviceInfo({
                device_id: info.device_id,
                device_name: response.device_name ?? info.device_name,
                platform: response.platform ?? info.platform,
                registered: response.success,
                created_at: this.toTimestamp(response.created_at),
            });
        } catch (err) {
            logger.error('Device registration failed:', err);
            // [EN] Keep the local device in store so the startup overlay can show a precise registration failure.
            // [中] 即使註冊失敗也保留本地裝置資料，讓啟動畫面能明確顯示註冊失敗。
            // [日] 登録失敗時もローカル端末情報を store に残し、起動画面で失敗を明確に扱えるようにする。
            useDeviceStore.getState().updateDeviceInfo({
                device_id: info.device_id,
                device_name: info.device_name,
                platform: info.platform,
                registered: false,
                created_at: info.created_at,
            });
        }
    }

    /**
     * [EN] Clears local device data and frontend state for reset/removal flows.
     * [中] 在重置/移除流程中清除本地裝置資料與前端狀態。
     * [日] リセット/削除フローでローカル端末情報と frontend state を消去する。
     */
    async resetDevice(): Promise<void> {
        await clearDeviceId();
        useDeviceStore.getState().reset();
    }

    /**
     * [EN] Updates a backend device by path device_id and syncs the current local device store only when IDs match.
     * [中] 依 path device_id 更新後端裝置；只有更新目標是目前本機裝置時才同步 store。
     * [日] path の device_id で backend 端末を更新し、対象が現在のローカル端末と一致する場合だけ store に反映する。
     */
    async updateDeviceInfo(deviceId: string, payload: DeviceUpdateRequest): Promise<DeviceUpdateResponse> {
        const response = await deviceApi.update(deviceId, payload);
        logger.info('Device update response:', response);

        const current = useDeviceStore.getState();
        if (response.success && current.deviceId === deviceId) {
            useDeviceStore.getState().updateDeviceInfo({
                device_id: response.device_id,
                device_name: response.device_name ?? payload.device_name,
                platform: response.platform ?? payload.platform,
                registered: current.registered,
                created_at: current.createdAt ?? this.toTimestamp(response.created_at),
                updated_at: this.toTimestamp(response.updated_at),
            });
        }

        return response;
    }

    /**
     * [EN] Registers the current local device with the backend upsert endpoint and marks local registration on success.
     * [中] 將目前本地裝置送到後端 upsert 註冊端點，成功後同步標記本地已註冊。
     * [日] 現在のローカル端末を backend の upsert 登録エンドポイントへ送り、成功時にローカル登録状態を更新する。
     */
    private async registerWithBackend(info: DeviceInfo): Promise<DeviceRegisterResponse> {
        const payload: DeviceRegistrationRequest = {
            device_id: info.device_id,
            device_name: info.device_name,
            platform: info.platform,
        };

        const response = await deviceApi.register(payload);
        logger.info('Device register response:', response);

        if (response.success && isTauri()) {
            await updateDeviceRegistration(true);
        }

        return response;
    }

    /** Converts a string/number/undefined timestamp to milliseconds. */
    private toTimestamp(value: string | number | undefined): number {
        if (typeof value === 'number') return value;
        if (!value) return Date.now();
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? Date.now() : parsed;
    }
}

export const deviceService = new DeviceService();
