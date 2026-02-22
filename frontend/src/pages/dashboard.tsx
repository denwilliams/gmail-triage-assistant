import { useAuth } from "@/hooks/use-auth";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Welcome, {user?.email}</CardTitle>
          <CardDescription>
            Your Gmail Triage Assistant is running and monitoring your inbox.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
