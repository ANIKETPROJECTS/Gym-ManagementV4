import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { SessionReminders } from "@/components/session-reminders";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Calendar, Video, UtensilsCrossed, User, ChevronDown, TrendingUp, Scale, Ruler, Trophy, FileText, Image, Menu, X, ArrowLeft, Calculator, LayoutDashboard, Flame, Zap, Target, Camera, BarChart3, LogOut, Phone, Dumbbell } from "lucide-react";
import { useLocation } from "wouter";
import { useLanguage } from "@/lib/language-context";
import { queryClient } from "@/lib/queryClient";
import { useState } from "react";
import logoImage from "@assets/TWWLOGO_1763965276890.png";
import { TrainerContactDropdown } from "@/components/trainer-contact-dialog";

interface ClientHeaderProps {
  currentPage?: 'dashboard' | 'workouts' | 'videos' | 'diet' | 'sessions' | 'history' | 'workout-history' | 'workout-plans' | 'progress' | 'progress-photos' | 'profile' | 'weight-tracking' | 'body-measurements' | 'weekly-completion' | 'achievements' | 'achievement-gallery' | 'personal-records' | 'monthly-reports' | 'goals' | 'calculators' | 'calendar' | 'messages' | 'support-tickets' | 'announcements' | 'forum';
  packageName?: string;
}

export function ClientHeader({ currentPage, packageName }: ClientHeaderProps) {
  const [, setLocation] = useLocation();
  const { t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Check if client has Pro or Elite package
  const isProOrElite = !!(packageName && (packageName.toLowerCase().includes('pro') || packageName.toLowerCase().includes('elite')));


  const [location] = useLocation();
  
  const showBackButton = () => {
    return location !== "/client" && location !== "/client-access" && location !== "/";
  };

  return (
    <header className="border-b-4 border-b-amber-500 dark:border-b-amber-600">
      <div className="container mx-auto px-6 py-3">
        <div className="flex items-center justify-between gap-2">
          {/* Logo and Back Button */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {showBackButton() && (
              <button 
                onClick={() => history.back()} 
                className="md:hidden p-2 hover-elevate active-elevate-2 rounded-md flex-shrink-0"
                data-testid="button-back-mobile"
              >
                <ArrowLeft className="h-6 w-6 text-foreground" />
              </button>
            )}
            <button 
              onClick={() => setLocation("/client")} 
              className="flex items-center gap-1 hover-elevate active-elevate-2 rounded-md px-1 py-1 flex-shrink-0"
              data-testid="button-logo-home"
            >
              <img src={logoImage} alt="FitPro" className="h-16 w-16 object-contain" />
              <span className="text-lg font-display font-bold tracking-tight hidden lg:inline">FitPro</span>
            </button>
          </div>

          {/* Main Navigation */}
          <nav className="hidden lg:flex items-center gap-6 flex-1 justify-center px-4">
            <Button 
              variant="ghost" 
              className={`${currentPage === 'dashboard' ? 'nav-underline-blue' : ''} px-4`}
              onClick={() => setLocation("/client")}
              data-testid="link-dashboard"
            >
              <LayoutDashboard className="h-5 w-5 mr-2 text-blue-600" />
              <span className="hidden xl:inline font-medium">Dashboard</span>
            </Button>

            <Button 
              variant="ghost" 
              className={`${currentPage === 'sessions' ? 'nav-underline-purple' : ''} px-4`}
              onClick={() => setLocation("/client/sessions")}
              data-testid="link-sessions"
            >
              <Calendar className="h-5 w-5 mr-2 text-purple-600" />
              <span className="hidden xl:inline font-medium">Sessions</span>
            </Button>

            <Button 
              variant="ghost" 
              className={`${currentPage === 'videos' ? 'nav-underline-red' : ''} px-4`}
              onClick={() => setLocation("/client/videos")}
              data-testid="link-videos"
            >
              <Video className="h-5 w-5 mr-2 text-red-600" />
              <span className="hidden xl:inline font-medium">Videos</span>
            </Button>

            <Button 
              variant="ghost" 
              className={`${currentPage === 'diet' ? 'nav-underline-orange' : ''} px-4`}
              onClick={() => setLocation("/client/diet")}
              data-testid="link-diet"
            >
              <UtensilsCrossed className="h-5 w-5 mr-2 text-orange-600" />
              <span className="hidden xl:inline font-medium">Diet</span>
            </Button>

            <Button 
              variant="ghost" 
              className={`${currentPage === 'workout-plans' ? 'nav-underline-amber' : ''} px-4`}
              onClick={() => setLocation("/client/workout-plans")}
              data-testid="link-workout-plans"
            >
              <Dumbbell className="h-5 w-5 mr-2 text-amber-600" />
              <span className="hidden xl:inline font-medium">Workout Plans</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className={`${['weight-tracking', 'body-measurements', 'achievements', 'personal-records', 'monthly-reports', 'progress', 'goals'].includes(currentPage || '') ? 'nav-underline-green' : ''} px-4`} data-testid="dropdown-progress">
                  <TrendingUp className="h-5 w-5 mr-2 text-green-600" />
                  <span className="hidden xl:inline font-medium">Progress</span>
                  <ChevronDown className="h-5 w-5 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuItem onClick={() => setLocation("/client/progress/weight-tracking")} className={`cursor-pointer ${currentPage === 'weight-tracking' ? 'bg-blue-50 dark:bg-blue-950' : ''}`} data-testid="link-weight-tracking">
                  <Scale className="h-4 w-4 mr-3 text-blue-600" />
                  <span className="font-medium">{t('nav.weightTracking')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocation("/client/progress/body-measurements")} className={`cursor-pointer ${currentPage === 'body-measurements' ? 'bg-orange-50 dark:bg-orange-950' : ''}`} data-testid="link-body-measurements">
                  <Ruler className="h-4 w-4 mr-3 text-orange-600" />
                  <span className="font-medium">{t('nav.bodyMeasurements')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLocation("/client/progress/personal-records")} className={`cursor-pointer ${currentPage === 'personal-records' ? 'bg-amber-50 dark:bg-amber-950' : ''}`} data-testid="link-personal-records">
                  <Zap className="h-4 w-4 mr-3 text-amber-600" />
                  <span className="font-medium">{t('nav.personalRecords')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLocation("/client/progress-photos")} className={`cursor-pointer ${currentPage === 'progress-photos' ? 'bg-pink-50 dark:bg-pink-950' : ''}`} data-testid="link-progress-photos">
                  <Camera className="h-4 w-4 mr-3 text-pink-600" />
                  <span className="font-medium">{t('nav.progressPhotos')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocation("/client/progress/monthly-reports")} className={`cursor-pointer ${currentPage === 'monthly-reports' ? 'bg-purple-50 dark:bg-purple-950' : ''}`} data-testid="link-monthly-reports">
                  <BarChart3 className="h-4 w-4 mr-3 text-purple-600" />
                  <span className="font-medium">{t('nav.monthlyReports')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLocation("/client/calculators")} className={`cursor-pointer ${currentPage === 'calculators' ? 'bg-teal-50 dark:bg-teal-950' : ''}`} data-testid="link-calculators">
                  <Calculator className="h-4 w-4 mr-3 text-teal-600" />
                  <span className="font-medium">Nutrition Calculators</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-md hover-elevate active-elevate-2"
            data-testid="button-mobile-menu"
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>

          {/* Icon Buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <SessionReminders />
            <ThemeToggle />
            <TrainerContactDropdown isProOrElite={isProOrElite} />
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setLocation("/client/profile")} 
              data-testid="button-profile"
            >
              <User className="h-5 w-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => {
                localStorage.clear();
                setLocation("/");
              }} 
              data-testid="button-logout"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <nav className="md:hidden mt-4 pb-4 space-y-2 border-t pt-4">
            <Button 
              variant="ghost" 
              className={`w-full justify-start ${currentPage === 'dashboard' ? 'bg-accent' : ''}`}
              onClick={() => {
                setLocation("/client");
                setMobileMenuOpen(false);
              }}
              data-testid="link-dashboard-mobile"
            >
              {t('nav.dashboard')}
            </Button>

            <Button 
              variant="ghost" 
              className={`w-full justify-start ${currentPage === 'sessions' ? 'bg-accent' : ''}`}
              onClick={() => {
                setLocation("/client/sessions");
                setMobileMenuOpen(false);
              }}
              data-testid="link-sessions-mobile"
            >
              <Calendar className="h-4 w-4 mr-2" />
              {t('nav.liveSessions')}
            </Button>

            <Button 
              variant="ghost" 
              className={`w-full justify-start ${currentPage === 'videos' ? 'bg-accent' : ''}`}
              onClick={() => {
                setLocation("/client/videos");
                setMobileMenuOpen(false);
              }}
              data-testid="link-videos-mobile"
            >
              <Video className="h-4 w-4 mr-2" />
              {t('nav.videoLibrary')}
            </Button>

            <Button 
              variant="ghost" 
              className={`w-full justify-start ${currentPage === 'diet' ? 'bg-accent' : ''}`}
              onClick={() => {
                setLocation("/client/diet");
                setMobileMenuOpen(false);
              }}
              data-testid="link-diet-mobile"
            >
              <UtensilsCrossed className="h-4 w-4 mr-2" />
              {t('nav.nutrition')}
            </Button>

            <Button 
              variant="ghost" 
              className={`w-full justify-start ${currentPage === 'workout-plans' ? 'bg-accent' : ''}`}
              onClick={() => {
                setLocation("/client/workout-plans");
                setMobileMenuOpen(false);
              }}
              data-testid="link-workout-plans-mobile"
            >
              <Dumbbell className="h-4 w-4 mr-2" />
              Workout Plans
            </Button>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground px-2">{t('nav.progressAnalytics')}</p>
              <Button 
                variant="ghost" 
                className={`w-full justify-start pl-6 ${currentPage === 'weight-tracking' ? 'bg-accent' : ''}`}
                onClick={() => {
                  setLocation("/client/progress/weight-tracking");
                  setMobileMenuOpen(false);
                }}
                data-testid="link-weight-tracking-mobile"
              >
                <Scale className="h-4 w-4 mr-2" />
                {t('nav.weightTracking')}
              </Button>
              <Button 
                variant="ghost" 
                className={`w-full justify-start pl-6 ${currentPage === 'body-measurements' ? 'bg-accent' : ''}`}
                onClick={() => {
                  setLocation("/client/progress/body-measurements");
                  setMobileMenuOpen(false);
                }}
                data-testid="link-body-measurements-mobile"
              >
                <Ruler className="h-4 w-4 mr-2" />
                {t('nav.bodyMeasurements')}
              </Button>
              <Button 
                variant="ghost" 
                className={`w-full justify-start pl-6 ${currentPage === 'personal-records' ? 'bg-accent' : ''}`}
                onClick={() => {
                  setLocation("/client/progress/personal-records");
                  setMobileMenuOpen(false);
                }}
                data-testid="link-personal-records-mobile"
              >
                <Trophy className="h-4 w-4 mr-2" />
                {t('nav.personalRecords')}
              </Button>
              <Button 
                variant="ghost" 
                className={`w-full justify-start pl-6 ${currentPage === 'progress-photos' ? 'bg-accent' : ''}`}
                onClick={() => {
                  setLocation("/client/progress-photos");
                  setMobileMenuOpen(false);
                }}
                data-testid="link-progress-photos-mobile"
              >
                <Image className="h-4 w-4 mr-2" />
                {t('nav.progressPhotos')}
              </Button>
              <Button 
                variant="ghost" 
                className={`w-full justify-start pl-6 ${currentPage === 'monthly-reports' ? 'bg-accent' : ''}`}
                onClick={() => {
                  setLocation("/client/progress/monthly-reports");
                  setMobileMenuOpen(false);
                }}
                data-testid="link-monthly-reports-mobile"
              >
                <FileText className="h-4 w-4 mr-2" />
                {t('nav.monthlyReports')}
              </Button>
              <Button 
                variant="ghost" 
                className={`w-full justify-start pl-6 ${currentPage === 'calculators' ? 'bg-accent' : ''}`}
                onClick={() => {
                  setLocation("/client/calculators");
                  setMobileMenuOpen(false);
                }}
                data-testid="link-calculators-mobile"
              >
                <Calculator className="h-4 w-4 mr-2" />
                Nutrition Calculators
              </Button>
            </div>

            <div className="flex items-center gap-2 pt-4 border-t">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => {
                  setLocation("/client/profile");
                  setMobileMenuOpen(false);
                }}
                data-testid="link-profile-mobile"
              >
                <User className="h-5 w-5" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => {
                  localStorage.clear();
                  setLocation("/");
                  setMobileMenuOpen(false);
                }}
                data-testid="button-logout-mobile"
                title="Logout"
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}
