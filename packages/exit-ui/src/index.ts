export { esploraUrlFor } from "./esplora";
export {
    loadOrCreateFeeKey,
    resetFeeKey,
    makeFeeWallet,
    splitBalances,
    type FeeWalletHandle,
    type FeeBalances,
} from "./feeWallet";
export {
    parsePackageJson,
    parsePackageObject,
    decodePackageBlob,
    encodeExitBundle,
    packageParamFromUrl,
    readFileText,
    FEE_KEY_RE,
    type LoadedPackage,
} from "./package";
export {
    saveSession,
    loadSession,
    clearSession,
    restoreSession,
    forgetNeedsConfirmation,
    defaultStore,
    type ExitSession,
    type SessionStore,
    type SessionScreen,
} from "./session";
export { phaseFor, phaseForChainState, KIND_LABEL, PHASE_STYLE, type StepPhase } from "./steps";
export {
    probeExitProgress,
    summarizeExitProgress,
    outstandingFundingSats,
    fundingNeed,
    CHILD_DUST_AMOUNT,
    isSweepMature,
    anchorTxidFor,
    stepState,
    ctaLabelFor,
    type ChainReader,
    type ExitProgress,
    type ExitProgressSummary,
    type FundingNeed,
    type TxFacts,
    type TxState,
} from "./progress";

// UI primitives. Styled against the `--color-exit-*` / `--radius-exit` contract
// the consuming app declares in its own `@theme`, so each app keeps its palette.
export { cn } from "./ui/cn";
export { MONO } from "./ui/mono";
export { Button, type ButtonProps } from "./ui/button";
export { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
export { Progress } from "./ui/progress";
export { Tooltip } from "./ui/tooltip";
export { CopyableHash, truncateMiddle } from "./ui/copyable";
export { formatSats, btc } from "./format";

// Screens, and the flow that drives them. `ExitFlow` is the whole feature;
// the individual screens are exported for hosts that want to compose their own.
export { ImportScreen } from "./screens/ImportScreen";
export { ReviewScreen } from "./screens/ReviewScreen";
export { FundingGate } from "./screens/FundingGate";
export { RunScreen } from "./screens/RunScreen";
export { ExitFlow } from "./ExitFlow";
