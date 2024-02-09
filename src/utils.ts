export const PLATFORM = function () {
    switch (process.platform) {
        case "linux":
            return "linux";
        case "darwin":
            return "macos";
        case "win32":
            return "windows";
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}();

export const ARCHITECTURE = function () {
    switch (process.arch) {
        case "arm64":
            return "arm64";
        case "x64":
            return "x64";
        default:
            throw new Error(`Unsupported architecture: ${process.arch}`);
    }
}();

export function stringify(obj: unknown) {
    if (typeof obj === 'string') { return obj; }
    if (obj instanceof Error) { return obj.message; }
    if (typeof obj === 'object') { return JSON.stringify(obj); }
    return (obj as any).toString();
}