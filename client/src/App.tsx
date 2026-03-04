import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import CitizenPortal from "@/pages/citizen-portal";
import Dashboard from "@/pages/dashboard";
import LoginPage from "@/pages/login";
import ResetPasswordPage from "@/pages/reset-password";

function Router() {
  return (
    <Switch>
      <Route path="/" component={CitizenPortal} />
      <Route path="/login" component={LoginPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/dashboard" component={Dashboard} />
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
