import { ChangeEvent, SubmitEvent, useEffect, useMemo, useRef, useState } from "react";
import { CircleUserRound } from "lucide-react";
import Cropper, { ReactCropperElement } from "react-cropper";
import "cropperjs/dist/cropper.css";
import { Navbar } from "@/components/layout/Navbar.tsx";
import { useUserStore } from "@/stores/userStore.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { userService } from "@/services/userService.ts";
import { logger } from "@/utils/logger.ts";
import { toast } from "sonner";
import { env } from "@/config/env.ts";

export const ProfilePage = () => {
    const user = useUserStore((state) => state.currentUser);
    const [name, setName] = useState(user?.name ?? "");
    const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
    const [croppedAvatarFile, setCroppedAvatarFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isCropEditorOpen, setIsCropEditorOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const cropperRef = useRef<ReactCropperElement>(null);
    const longPressTimerRef = useRef<number | null>(null);

    const avatarSource = useMemo(
        () => previewUrl ?? user?.avatar ?? null,
        [previewUrl, user?.avatar]
    );

    useEffect(() => {
        setName(user?.name ?? "");
    }, [user?.name]);

    useEffect(() => {
        return () => {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
            }
            if (longPressTimerRef.current) {
                window.clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
            }
        };
    }, [previewUrl]);

    const handleChooseAvatar = () => {
        fileInputRef.current?.click();
    };

    const handleAvatarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }

        setSelectedAvatarFile(file);
        setCroppedAvatarFile(null);
        setPreviewUrl(URL.createObjectURL(file));
    };

    const clearLongPressTimer = () => {
        if (!longPressTimerRef.current) return;
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
    };

    const handleAvatarPointerDown = () => {
        if (!avatarSource) return;
        clearLongPressTimer();
        longPressTimerRef.current = window.setTimeout(() => {
            setIsCropEditorOpen(true);
            longPressTimerRef.current = null;
        }, 500);
    };

    const applyCrop = async () => {
        const cropper = cropperRef.current?.cropper;
        if (!cropper) return;

        const canvas = cropper.getCroppedCanvas({
            width: 512,
            height: 512,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: "high",
        });

        if (!canvas) return;

        const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/png")
        );

        if (!blob) return;

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }

        const file = new File([blob], "avatar-cropped.png", { type: "image/png" });
        setCroppedAvatarFile(file);
        setSelectedAvatarFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        setIsCropEditorOpen(false);
    };

    const handleProfileSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();

        // Upload avatar
        const avatarFile = croppedAvatarFile ?? selectedAvatarFile;

        if (avatarFile) {
            toast.loading('Uploading avatar...');
            userService.uploadAvatar(avatarFile)
                .then(({ avatarUrl }) => {
                    const user = useUserStore.getState().currentUser;
                    if (user) {
                        user.avatar = avatarUrl;
                        useUserStore.getState().setCurrentUser(user);
                    }
                    toast.dismiss();
                    toast.success('Avatar uploaded successfully');
                })
                .catch((error) => {
                    logger.error('Failed to upload avatar', error);
                    toast.error('Failed to upload avatar');
                });
        }

        // Update profile
        if (name !== user?.name) {
            await userService.updateUser({ name });
            toast.success('Profile updated successfully');
        }
    };

    return (
        <div className="flex flex-col h-screen overflow-hidden">
            <Navbar/>
            <main className="flex-1 p-6 flex items-center justify-center">
                <Card className="w-full max-w-md">
                    <CardHeader className="pb-4">
                        <CardTitle className="text-xl">Profile</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form className="space-y-6" onSubmit={handleProfileSubmit}>
                            <div className="flex flex-col items-center">
                                <div className="relative h-32 w-32 overflow-hidden rounded-full">
                                    <Avatar
                                        className="h-32 w-32 border border-border shadow-sm"
                                        onPointerDown={handleAvatarPointerDown}
                                        onPointerUp={clearLongPressTimer}
                                        onPointerLeave={clearLongPressTimer}
                                        onPointerCancel={clearLongPressTimer}
                                    >
                                        {previewUrl && (
                                            <AvatarImage
                                                src={previewUrl}
                                                alt="Avatar preview"
                                                className="object-cover"
                                            />
                                        )}
                                        {!previewUrl && user?.avatar && (
                                            <AvatarImage
                                                src={env.API_BASE_URL + user.avatar}
                                                alt={`${name || "User"} avatar`}
                                                className="object-cover"
                                            />
                                        )}
                                        <AvatarFallback>
                                            <CircleUserRound className="h-12 w-12 text-muted-foreground"/>
                                        </AvatarFallback>
                                    </Avatar>
                                    <button
                                        type="button"
                                        onClick={handleChooseAvatar}
                                        className="absolute inset-x-0 bottom-0 h-9 rounded-b-full bg-black/45 text-white text-xs font-medium transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    >
                                        Edit
                                    </button>
                                </div>

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleAvatarFileChange}
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="profile-name" className="text-sm font-medium">
                                    Name
                                </label>
                                <Input
                                    id="profile-name"
                                    value={name}
                                    onChange={(event) => setName(event.target.value)}
                                    placeholder="Enter your name"
                                />
                            </div>

                            <Button type="submit" className="w-full">
                                Save Changes
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </main>

            {isCropEditorOpen && avatarSource && (
                <div
                    className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4">
                    <div className="w-full max-w-3xl rounded-xl border border-border bg-card p-4 md:p-6">
                        <div className="mb-4">
                            <h2 className="text-lg font-semibold">Adjust Avatar</h2>
                            <p className="text-xs text-muted-foreground mt-1">
                                Drag the image and resize the corners to frame your avatar.
                            </p>
                        </div>

                        <div
                            className="avatar-cropper-wrapper h-[58vh] min-h-[320px] w-full overflow-hidden rounded-lg bg-black/80">
                            <Cropper
                                src={avatarSource}
                                className="avatar-cropper h-full w-full"
                                style={{ height: "100%", width: "100%" }}
                                initialAspectRatio={1}
                                aspectRatio={1}
                                guides={true}
                                center={true}
                                highlight={true}
                                viewMode={1}
                                dragMode="move"
                                scalable={false}
                                cropBoxResizable={true}
                                cropBoxMovable={true}
                                zoomable={true}
                                zoomOnTouch={true}
                                zoomOnWheel={true}
                                responsive={true}
                                autoCropArea={0.7}
                                background={false}
                                checkOrientation={false}
                                ref={cropperRef}
                            />
                        </div>

                        <div className="mt-4 flex items-center justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsCropEditorOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Button type="button" onClick={applyCrop}>
                                Apply
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
