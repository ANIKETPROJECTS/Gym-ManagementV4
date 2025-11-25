import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/lib/language-context";
import Landing from "@/pages/landing";
import ClientAccess from "@/pages/client-access";
import AdminLogin from "@/pages/admin-login";
import TrainerLogin from "@/pages/trainer-login";
import ForgotPassword from "@/pages/forgot-password";
import AdminForgotPassword from "@/pages/admin-forgot-password";
import ResetPassword from "@/pages/reset-password";
import AdminDashboard from "@/pages/admin-dashboard";
import AdminClientsEnhanced from "@/pages/admin-clients-enhanced";
import AdminVideos from "@/pages/admin-videos";
import AdminDiet from "@/pages/admin-diet";
import AdminSessions from "@/pages/admin-sessions";
import AdminAnalyticsEnhanced from "@/pages/admin-analytics-enhanced";
import AdminRevenueEnhanced from "@/pages/admin-revenue-enhanced";
import AdminAnalyticsReports from "@/pages/admin-analytics-reports";
import AdminSettings from "@/pages/admin-settings";
import AdminTrainersEnhanced from "@/pages/admin-trainers-enhanced";
import TrainerDashboard from "@/pages/trainer-dashboard";
import TrainerClients from "@/pages/trainer-clients";
import TrainerDiet from "@/pages/trainer-diet";
import TrainerVideos from "@/pages/trainer-videos";
import TrainerSessions from "@/pages/trainer-sessions";
import TrainerAnalytics from "@/pages/trainer-analytics";
import ClientDashboard from "@/pages/client-dashboard";
import ClientWorkouts from "@/pages/client-workouts";
import ClientVideos from "@/pages/client-videos";
import ClientVideoLibrary from "@/pages/client-video-library";
import ClientDiet from "@/pages/client-diet";
import ClientSessions from "@/pages/client-sessions";
import ClientHistory from "@/pages/client-history";
import ClientProgressPhotos from "@/pages/client-progress-photos";
import ClientProfile from "@/pages/client-profile";
import SessionRoom from "@/pages/session-room";
import ClientWeightTracking from "@/pages/client-weight-tracking";
import ClientBodyMeasurements from "@/pages/client-body-measurements";
import ClientProgressCharts from "@/pages/client-progress-charts";
import ClientAchievements from "@/pages/client-achievements";
import ClientPersonalRecords from "@/pages/client-personal-records";
import ClientWeeklyCompletion from "@/pages/client-weekly-completion";
import ClientMonthlyReports from "@/pages/client-monthly-reports";
import ClientGoals from "@/pages/client-goals";
import ClientCalculators from "@/pages/client-calculators";
import ClientNotifications from "@/pages/client-notifications";
import ClientCalendar from "@/pages/client-calendar";
import ClientWorkoutPlans from "@/pages/client-workout-plans";
import AnnouncementsPage from "@/pages/announcements";
import SupportTicketsPage from "@/pages/support-tickets";
import TrainerMessaging from "@/pages/trainer-messaging";
import CommunityForum from "@/pages/community-forum";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/client-access" component={ClientAccess} />
      <Route path="/admin" component={AdminLogin} />
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/trainer" component={TrainerLogin} />
      <Route path="/trainer/login" component={TrainerLogin} />
      <Route path="/admin/forgot-password" component={AdminForgotPassword} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/admin/dashboard" component={AdminDashboard} />
      <Route path="/admin/clients" component={AdminClientsEnhanced} />
      <Route path="/admin/videos" component={AdminVideos} />
      <Route path="/admin/diet" component={AdminDiet} />
      <Route path="/admin/sessions" component={AdminSessions} />
      <Route path="/admin/analytics" component={AdminAnalyticsEnhanced} />
      <Route path="/admin/reports" component={AdminAnalyticsReports} />
      <Route path="/admin/revenue" component={AdminRevenueEnhanced} />
      <Route path="/admin/settings" component={AdminSettings} />
      <Route path="/admin/trainers" component={AdminTrainersEnhanced} />
      <Route path="/trainer/dashboard" component={TrainerDashboard} />
      <Route path="/trainer/clients" component={TrainerClients} />
      <Route path="/trainer/diet" component={TrainerDiet} />
      <Route path="/trainer/videos" component={TrainerVideos} />
      <Route path="/trainer/sessions" component={TrainerSessions} />
      <Route path="/trainer/analytics" component={TrainerAnalytics} />
      <Route path="/client" component={ClientDashboard} />
      <Route path="/client/workouts" component={ClientWorkouts} />
      <Route path="/client/videos" component={ClientVideoLibrary} />
      <Route path="/client/video-library" component={ClientVideoLibrary} />
      <Route path="/client/diet" component={ClientDiet} />
      <Route path="/client/sessions" component={ClientSessions} />
      <Route path="/session/:id" component={SessionRoom} />
      <Route path="/client/history" component={ClientHistory} />
      <Route path="/client/progress-photos" component={ClientProgressPhotos} />
      <Route path="/client/profile" component={ClientProfile} />
      <Route path="/client/progress/weight-tracking" component={ClientWeightTracking} />
      <Route path="/client/progress/body-measurements" component={ClientBodyMeasurements} />
      <Route path="/client/progress/charts" component={ClientProgressCharts} />
      <Route path="/client/progress/achievements" component={ClientAchievements} />
      <Route path="/client/progress/achievement-gallery" component={ClientAchievements} />
      <Route path="/client/progress/personal-records" component={ClientPersonalRecords} />
      <Route path="/client/progress/weekly-completion" component={ClientWeeklyCompletion} />
      <Route path="/client/progress/monthly-reports" component={ClientMonthlyReports} />
      <Route path="/client/goals" component={ClientGoals} />
      <Route path="/client/calculators" component={ClientCalculators} />
      <Route path="/client/notifications" component={ClientNotifications} />
      <Route path="/client/calendar" component={ClientCalendar} />
      <Route path="/client/workout-plans" component={ClientWorkoutPlans} />
      <Route path="/client/announcements" component={AnnouncementsPage} />
      <Route path="/client/support-tickets" component={SupportTicketsPage} />
      <Route path="/client/messages" component={TrainerMessaging} />
      <Route path="/client/forum" component={CommunityForum} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

export default App;
