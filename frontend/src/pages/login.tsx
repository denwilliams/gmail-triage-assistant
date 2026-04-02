import { useAuth } from "@/hooks/use-auth";
import { Navigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Mail } from "lucide-react";

export default function LoginPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Mail className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Gmail Triage</CardTitle>
          <CardDescription>
            AI-powered email management that automatically categorizes and
            organizes your Gmail inbox
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild size="lg" className="w-full">
            <a href="/auth/login">Sign in with Google</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
