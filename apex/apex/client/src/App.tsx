import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ThemeProvider } from "@/hooks/use-theme";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import SignUp from "@/pages/SignUp";
import Dashboard from "@/pages/Dashboard";
import Strength from "@/pages/Strength";
import Cardio from "@/pages/Cardio";
import Bodyweight from "@/pages/Bodyweight";
import Calories from "@/pages/Calories";
import History from "@/pages/History";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) setLocation("/login");
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!user) return null;
  return <Component />;
}

function PublicOnlyRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user) setLocation("/dashboard");
  }, [isLoading, user, setLocation]);

  if (isLoading) return null;
  if (user) return null;
  return <Component />;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={() => <PublicOnlyRoute component={Landing} />} />
      <Route path="/login" component={() => <PublicOnlyRoute component={Login} />} />
      <Route path="/signup" component={() => <PublicOnlyRoute component={SignUp} />} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/strength" component={() => <ProtectedRoute component={Strength} />} />
      <Route path="/cardio" component={() => <ProtectedRoute component={Cardio} />} />
      <Route path="/bodyweight" component={() => <ProtectedRoute component={Bodyweight} />} />
      <Route path="/calories" component={() => <ProtectedRoute component={Calories} />} />
      <Route path="/history" component={() => <ProtectedRoute component={History} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
