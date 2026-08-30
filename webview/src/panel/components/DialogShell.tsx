import { type ReactNode, useCallback, useEffect, useRef } from "react";

/**
 * The modal frame the branch dialogs share: backdrop dismissal, Escape, and
 * the panel chrome. Extracted so Manage Remotes and Clean Up Branches look
 * like Create Branch without copying its shell.
 */
export function DialogShell({
  title,
  error,
  onClose,
  children,
  footer,
  width = 420,
}: {
  title: string;
  error?: string | null;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.4)",
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        style={{
          background: "var(--vscode-editorWidget-background, #252526)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "16px 20px",
          minWidth: width,
          maxWidth: "min(90vw, 720px)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 12,
            color: "var(--app-fg)",
          }}
        >
          {title}
        </div>

        {error && (
          <div
            style={{
              background:
                "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
              border:
                "1px solid var(--vscode-inputValidation-errorBorder, #be1100)",
              borderRadius: 4,
              padding: "8px 10px",
              marginBottom: 12,
              fontSize: 12,
              color: "var(--vscode-errorForeground, #f48771)",
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {children}
        </div>

        {footer && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 14,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function DialogButton({
  children,
  onClick,
  variant = "secondary",
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const palette = {
    primary: {
      background: "var(--vscode-button-background, #0e639c)",
      color: "var(--vscode-button-foreground, #fff)",
      border: "1px solid transparent",
    },
    secondary: {
      background: "var(--vscode-button-secondaryBackground, transparent)",
      color: "var(--vscode-button-secondaryForeground, #ccc)",
      border: "1px solid var(--border)",
    },
    danger: {
      background: "var(--vscode-inputValidation-errorBorder, #be1100)",
      color: "#fff",
      border: "1px solid transparent",
    },
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...palette,
        padding: "4px 14px",
        fontSize: 12,
        borderRadius: 4,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
