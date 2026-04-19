import { useParams, Navigate } from "react-router";
import type { Bucket } from "@/lib/types";
import { BUCKET_OPTIONS } from "@/components/v2/badges";
import NewsletterBucketPage from "./newsletter";
import NotificationBucketPage from "./notification";
import HumanBucketPage from "./human";
import TransactionalBucketPage from "./transactional";
import SecurityBucketPage from "./security";
import CalendarBucketPage from "./calendar";

export default function BucketDispatch() {
  const { bucket } = useParams();
  if (!bucket || !BUCKET_OPTIONS.includes(bucket as Bucket)) {
    return <Navigate to="/v2" replace />;
  }
  switch (bucket as Bucket) {
    case "newsletter":
      return <NewsletterBucketPage />;
    case "notification":
      return <NotificationBucketPage />;
    case "human":
      return <HumanBucketPage />;
    case "transactional":
      return <TransactionalBucketPage />;
    case "security":
      return <SecurityBucketPage />;
    case "calendar":
      return <CalendarBucketPage />;
  }
}
