import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

type PageState = "loading" | "form" | "result";

type ResultState = {
  status: "success" | "error";
  message: string;
};

const INVALID_LINK_MESSAGE = "This reset link is invalid or has expired.";

function mapResetErrorMessage(message: string): string {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("session") ||
    normalized.includes("expired") ||
    normalized.includes("invalid")
  ) {
    return INVALID_LINK_MESSAGE;
  }

  if (normalized.includes("password")) {
    return "Please choose a stronger password and try again.";
  }

  return "Unable to reset your password right now. Please try again.";
}

export default function ResetPasswordPage() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [result, setResult] = useState<ResultState | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const exchangeAttemptedRef = useRef(false);
  const exchangeFailedRef = useRef(false);

  useEffect(() => {
    let resolved = false;

    const timeoutId = window.setTimeout(() => {
      if (resolved) {
        return;
      }

      resolved = true;
      setResult({ status: "error", message: INVALID_LINK_MESSAGE });
      setPageState("result");
    }, 10000);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "PASSWORD_RECOVERY" || resolved || exchangeFailedRef.current) {
        return;
      }

      resolved = true;
      window.clearTimeout(timeoutId);
      setPageState("form");
    });

    return () => {
      resolved = true;
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (exchangeAttemptedRef.current) {
      return;
    }

    exchangeAttemptedRef.current = true;

    const searchParams = new URLSearchParams(window.location.search);
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");

    if (!tokenHash || type !== "recovery") {
      return;
    }

    let isActive = true;

    const exchangeRecoveryToken = async () => {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "recovery",
      });

      if (!isActive || !error) {
        return;
      }

      exchangeFailedRef.current = true;
      setResult({ status: "error", message: INVALID_LINK_MESSAGE });
      setPageState("result");
    };

    void exchangeRecoveryToken();

    return () => {
      isActive = false;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const normalizedPassword = newPassword.trim();

    if (normalizedPassword.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }

    if (normalizedPassword !== confirmPassword.trim()) {
      setFormError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    setFormError("");

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: normalizedPassword,
      });

      if (updateError) {
        setFormError(mapResetErrorMessage(updateError.message));
        return;
      }

      const { error: signOutError } = await supabase.auth.signOut();

      if (signOutError) {
        setResult({
          status: "error",
          message: "Password updated, but we could not complete sign-out. Please sign in again.",
        });
        setPageState("result");
        return;
      }

      setResult({
        status: "success",
        message: "Your password has been reset successfully. Please sign in with your new password.",
      });
      setPageState("result");
    } catch {
      setFormError("Unable to reset your password right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (pageState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-100 dark:bg-slate-950">
        <Card className="w-full max-w-[420px] p-6 border">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 className="w-5 h-5 animate-spin text-slate-600" />
            <h1 className="text-lg font-semibold">Checking link...</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            We are verifying your password reset request.
          </p>
        </Card>
      </div>
    );
  }

  if (pageState === "result") {
    const isSuccess = result?.status === "success";
    const message = result?.message ?? INVALID_LINK_MESSAGE;

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-100 dark:bg-slate-950">
        <Card className="w-full max-w-[420px] p-6 border">
          <div className="flex items-center gap-3 mb-3">
            {isSuccess ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600" />
            )}
            <h1 className="text-lg font-semibold">
              {isSuccess ? "Password reset complete" : "Reset not completed"}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{message}</p>
          <a href="/login" className="text-sm text-slate-700 hover:text-slate-900 underline">
            Go to login
          </a>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-100 dark:bg-slate-950">
      <Card className="w-full max-w-[420px] p-6 border">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-slate-600" />
          <h1 className="text-lg font-semibold">Reset password</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Enter your new password to complete the reset.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1.5">New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-500/20"
              autoComplete="new-password"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-500/20"
              autoComplete="new-password"
              disabled={isSubmitting}
            />
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Updating password...
              </span>
            ) : (
              "Update password"
            )}
          </Button>
        </form>
      </Card>
    </div>
  );
}
