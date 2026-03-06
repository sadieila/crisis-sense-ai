import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import CitizenPortal from "@/pages/citizen-portal";
import Dashboard from "@/pages/dashboard";
import LoginPage from "@/pages/login";
import ResetPasswordPage from "@/pages/reset-password";

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
    </div>
  );
}

function ProtectedDashboardRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <Dashboard />;
}

function LoginRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (isAuthenticated) {
    return <Redirect to="/dashboard" />;
  }

  return <LoginPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={CitizenPortal} />
      <Route path="/login" component={LoginRoute} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/dashboard" component={ProtectedDashboardRoute} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
