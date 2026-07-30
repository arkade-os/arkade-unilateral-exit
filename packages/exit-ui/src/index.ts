export { esploraUrlFor } from "./esplora";
export { loadOrCreateFeeKey, resetFeeKey, makeFeeWallet, type FeeWalletHandle } from "./feeWallet";
export {
    parsePackageJson,
    decodePackageBlob,
    encodeExitBundle,
    packageParamFromUrl,
    readFileText,
    type LoadedPackage,
} from "./package";
export {
    saveSession,
    loadSession,
    clearSession,
    type ExitSession,
    type SessionStore,
    type SessionScreen,
} from "./session";
export { phaseFor, KIND_LABEL, PHASE_STYLE, type StepPhase } from "./steps";

// UI primitives. Styled against the `--color-exit-*` / `--radius-exit` contract
// the consuming app declares in its own `@theme`, so each app keeps its palette.
export { cn } from "./ui/cn";
export { MONO } from "./ui/mono";
export { Button, type ButtonProps } from "./ui/button";
export { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
export { Progress } from "./ui/progress";
export { Tooltip } from "./ui/tooltip";
export { CopyableHash, truncateMiddle } from "./ui/copyable";
