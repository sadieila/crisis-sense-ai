import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  AlertCircle,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { login } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      await login(email, password);
      toast({ title: "Signed in successfully." });
      navigate("/dashboard");
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Unable to sign in. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col">
      <div className="w-full py-3 px-6 bg-slate-800 dark:bg-slate-900">
        <div className="max-w-[500px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <ShieldCheck className="w-6 h-6 text-slate-300" />
            <div>
              <h1 className="text-sm font-bold leading-tight">Crisis-Sense</h1>
              <p className="text-xs text-slate-400">Secure organization login</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-slate-400 text-xs">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Secure connection</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-[420px] space-y-5">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-xl mx-auto flex items-center justify-center bg-slate-700 dark:bg-slate-700">
              <Building2 className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-lg font-bold text-foreground" data-testid="text-login-title">
              Organization Access
            </h2>
            <p className="text-sm text-muted-foreground">
              Sign in with your active Supabase account.
            </p>
          </div>

          <Card className="p-6 border">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div
                  className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400 flex items-center gap-2"
                  data-testid="text-login-error"
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@organization.org"
                    className="w-full pr-10 pl-4 py-2.5 rounded-lg border bg-background text-foreground text-sm focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 outline-none transition-all"
                    autoComplete="email"
                    data-testid="input-email"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pr-10 pl-10 py-2.5 rounded-lg border bg-background text-foreground text-sm focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 outline-none transition-all"
                    autoComplete="current-password"
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white dark:bg-slate-600 dark:hover:bg-slate-500"
                data-testid="button-login"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Signing in...
                  </span>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </Card>

          <div className="text-center">
            <a
              href="/"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
              data-testid="link-citizen-portal"
            >
              Back to report portal
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
