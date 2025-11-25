import { Button } from "@/components/ui/button";
import { ClientHeader } from "@/components/client-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ContactTrainerDialog } from "@/components/contact-trainer-dialog";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { MobileNavigation } from "@/components/mobile-navigation";
import { 
  Utensils, 
  Droplet, 
  Pill, 
  ShoppingCart, 
  Apple, 
  Flame, 
  AlarmClock,
  ChefHat,
  AlertTriangle,
  Check,
  RefreshCw,
  Zap,
  TrendingDown,
  UtensilsCrossed,
  Dumbbell,
  Plus,
  Coffee,
  Salad,
  Cookie,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

export default function ClientDiet() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [waterIntake, setWaterIntake] = useState(0);
  const [showDietaryReport, setShowDietaryReport] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [clientId, setClientId] = useState<string | null>(null);
  const [contactTrainerOpen, setContactTrainerOpen] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<any>(null);
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [clientAllergens, setClientAllergens] = useState<string[]>([]);
  const [showGroceryModal, setShowGroceryModal] = useState(false);
  const [supplements, setSupplements] = useState<any[]>([]);
  const [newSupplement, setNewSupplement] = useState({ name: '', dosage: '', timing: '' });
  const [supplementLog, setSupplementLog] = useState<any[]>([]);

  useEffect(() => {
    const id = localStorage.getItem("clientId");
    const allergens = localStorage.getItem("clientAllergens");
    console.log('[CLIENT DIET] Initializing, clientId from storage:', id);
    if (!id) {
      setLocation("/client-access");
    } else {
      setClientId(id);
      if (allergens) setClientAllergens(JSON.parse(allergens));
    }
  }, [setLocation]);

  const { data: dietPlans, isLoading: isLoadingDiet } = useQuery<any[]>({
    queryKey: ['/api/diet-plans', clientId],
    queryFn: async () => {
      // If we have a clientId, pass it as a query parameter so admins viewing client dashboards work correctly
      const url = clientId ? `/api/diet-plans?clientId=${clientId}` : '/api/diet-plans';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch diet plans');
      return response.json();
    }
  });

  // The API already filters by clientId, so we just use the first plan
  // If there are multiple plans, we take the most recent one (API sorts by createdAt desc)
  const currentPlan = dietPlans && dietPlans.length > 0 ? dietPlans[0] : null;
  
  // Debug logging
  useEffect(() => {
    console.log('[CLIENT DIET] Query data updated:', {
      dietPlans: dietPlans,
      isLoading: isLoadingDiet,
      planCount: dietPlans?.length || 0,
      firstPlan: currentPlan?.name || 'NO PLAN',
      clientId: clientId,
    });
  }, [dietPlans, isLoadingDiet, currentPlan, clientId]);
  
  // Reset currentWeek when diet plan changes - default to week 4 if it exists
  useEffect(() => {
    if (currentPlan?.meals && Array.isArray(currentPlan.meals)) {
      const weeks = currentPlan.meals.map((m: any) => m.weekNumber ?? 1);
      // Start at week 4 if it exists, otherwise start at week 1
      const startWeek = weeks.includes(4) ? 4 : 1;
      setCurrentWeek(startWeek);
    } else {
      setCurrentWeek(1);
    }
  }, [currentPlan?._id]);

  // Handler functions for clickable elements
  const handleDietaryReport = () => {
    setShowDietaryReport(true);
  };

  const handleAISuggestion = () => {
    toast({
      title: "AI Meal Suggestion",
      description: "Generating personalized meal recommendations based on your goals and preferences...",
    });
  };

  const handleNextWeek = () => {
    setCurrentWeek(currentWeek + 1);
  };

  const handlePrevWeek = () => {
    setCurrentWeek(currentWeek - 1);
  };

  // Meal type icon configuration with colors
  const getMealTypeIcon = (mealIndex: number) => {
    const configs = [
      { 
        icon: Coffee, 
        bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
        iconColor: 'text-yellow-600 dark:text-yellow-400',
        type: 'Breakfast'
      },
      { 
        icon: Salad, 
        bgColor: 'bg-green-100 dark:bg-green-900/30',
        iconColor: 'text-green-600 dark:text-green-400',
        type: 'Lunch'
      },
      { 
        icon: Zap, 
        bgColor: 'bg-blue-100 dark:bg-blue-900/30',
        iconColor: 'text-blue-600 dark:text-blue-400',
        type: 'Snack'
      },
      { 
        icon: ChefHat, 
        bgColor: 'bg-orange-100 dark:bg-orange-900/30',
        iconColor: 'text-orange-600 dark:text-orange-400',
        type: 'Dinner'
      },
      { 
        icon: Cookie, 
        bgColor: 'bg-pink-100 dark:bg-pink-900/30',
        iconColor: 'text-pink-600 dark:text-pink-400',
        type: 'Snack'
      }
    ];
    return configs[mealIndex % configs.length];
  };

  // Support both array and object (day-based) meal structures
  const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const [currentDay, setCurrentDay] = useState<string>('Monday');
  
  const hasDietPlan = currentPlan && (
    (Array.isArray(currentPlan.meals) && currentPlan.meals.length > 0) ||
    (typeof currentPlan.meals === 'object' && Object.keys(currentPlan.meals).length > 0)
  );
  
  // Get meals - handle both array and object (day-based) formats
  let dayMeals: any[] = [];
  let currentDayLabel = currentDay;
  
  if (hasDietPlan) {
    if (Array.isArray(currentPlan.meals)) {
      // Old format: array of meals, group by week
      const mealsByWeek: Record<number, any[]> = {};
      currentPlan.meals.forEach((meal: any) => {
        const weekNum = meal.weekNumber ?? 1;
        if (!mealsByWeek[weekNum]) {
          mealsByWeek[weekNum] = [];
        }
        mealsByWeek[weekNum].push(meal);
      });
      const totalWeeks = Math.max(...Object.keys(mealsByWeek).map(Number), 1);
      dayMeals = mealsByWeek[currentWeek] || [];
      currentDayLabel = `Week ${currentWeek}`;
    } else if (typeof currentPlan.meals === 'object') {
      // New format: object keyed by day name { Monday: {...}, Tuesday: {...} }
      const mealObj = currentPlan.meals[currentDay];
      if (mealObj) {
        // Convert from { breakfast: {...}, lunch: {...} } to array of meals
        dayMeals = Object.entries(mealObj).map(([type, data]: [string, any]) => ({
          type,
          ...data
        }));
      }
      currentDayLabel = currentDay;
    }
  }

  // Calculate week/day navigation variables
  let hasPrevWeek = false;
  let hasNextWeek = false;
  let totalWeeks = 1;
  
  if (Array.isArray(currentPlan?.meals)) {
    const mealsByWeek: Record<number, any[]> = {};
    currentPlan.meals.forEach((meal: any) => {
      const weekNum = meal.weekNumber ?? 1;
      if (!mealsByWeek[weekNum]) mealsByWeek[weekNum] = [];
      mealsByWeek[weekNum].push(meal);
    });
    totalWeeks = Math.max(...Object.keys(mealsByWeek).map(Number), 1);
    hasPrevWeek = currentWeek > 1;
    hasNextWeek = currentWeek < totalWeeks;
  }

  // Macro calculations for the current day/week
  const totalCalories = dayMeals.reduce((sum: number, meal: any) => sum + (meal.calories || 0), 0);
  const totalProtein = dayMeals.reduce((sum: number, meal: any) => sum + (meal.protein || 0), 0);
  const totalCarbs = dayMeals.reduce((sum: number, meal: any) => sum + (meal.carbs || 0), 0);
  const totalFats = dayMeals.reduce((sum: number, meal: any) => sum + (meal.fats || 0), 0);
  
  // These are daily totals (all meals for the current day)
  const dailyCalories = totalCalories;
  
  // Goal values (can be from diet plan or defaults)
  const calorieGoal = currentPlan?.targetCalories || 2513;
  const remainingCalories = calorieGoal - dailyCalories;
  const caloriePercent = (dailyCalories / calorieGoal) * 100;

  const waterGoal = currentPlan?.waterIntakeGoal || 8;

  const handleWaterIntake = () => {
    if (waterIntake < waterGoal) {
      setWaterIntake(waterIntake + 1);
    }
  };

  const handleResetWater = () => {
    setWaterIntake(0);
  };

  // Generate grocery list from current day meals
  const generateGroceryList = () => {
    const groceries: Record<string, any[]> = {};
    dayMeals.forEach((meal: any) => {
      if (meal.dishes) {
        meal.dishes.forEach((dish: any) => {
          const category = dish.category || 'Other';
          if (!groceries[category]) groceries[category] = [];
          groceries[category].push({
            name: dish.name,
            quantity: dish.quantity || '1',
            unit: dish.unit || 'unit'
          });
        });
      }
    });
    return groceries;
  };

  // Check if meal contains allergens
  const mealHasAllergens = (meal: any) => {
    if (!clientAllergens.length) return false;
    const allergenLower = clientAllergens.map(a => a.toLowerCase());
    const dishNames = meal.dishes?.map((d: any) => d.name.toLowerCase()).join(' ') || '';
    const mealName = meal.name.toLowerCase();
    return allergenLower.some(a => dishNames.includes(a) || mealName.includes(a));
  };

  // Add supplement to log
  const addSupplementLog = () => {
    if (newSupplement.name.trim()) {
      setSupplementLog([...supplementLog, { ...newSupplement, timestamp: new Date().toLocaleTimeString() }]);
      setNewSupplement({ name: '', dosage: '', timing: '' });
      toast({ title: 'Supplement logged', description: `${newSupplement.name} added to your supplement log.` });
    }
  };

  return (
    <div className="min-h-screen bg-background mb-24 md:mb-0">
      <ClientHeader />
      
      <main className="p-4 md:p-6 max-w-7xl mx-auto">
        <Tabs defaultValue="diet" className="w-full">
          <TabsList className="grid w-full grid-cols-6 mb-6">
            <TabsTrigger value="diet" data-testid="tab-diet">
              <UtensilsCrossed className="h-4 w-4 mr-2" />
              Diet
            </TabsTrigger>
            <TabsTrigger value="macros" data-testid="tab-macros">
              <Zap className="h-4 w-4 mr-2" />
              Macros
            </TabsTrigger>
            <TabsTrigger value="substitutions" data-testid="tab-substitutions">
              <RefreshCw className="h-4 w-4 mr-2" />
              Swap
            </TabsTrigger>
            <TabsTrigger value="allergens" data-testid="tab-allergens">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Allergens
            </TabsTrigger>
            <TabsTrigger value="grocery" data-testid="tab-grocery">
              <ShoppingCart className="h-4 w-4 mr-2" />
              Grocery
            </TabsTrigger>
            <TabsTrigger value="supplements" data-testid="tab-supplements">
              <Pill className="h-4 w-4 mr-2" />
              Supplements
            </TabsTrigger>
          </TabsList>

          {/* Diet Tab */}
          <TabsContent value="diet" className="space-y-6">
            {isLoadingDiet ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground">Loading your diet plan...</p>
                </CardContent>
              </Card>
            ) : !hasDietPlan ? (
              <Card className="bg-gradient-to-br from-orange-50 to-yellow-50 border-orange-200 dark:from-orange-950 dark:to-yellow-950 dark:border-orange-800">
                <CardContent className="p-8 text-center space-y-4">
                  <UtensilsCrossed className="h-16 w-16 mx-auto text-orange-500" />
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">No Diet Plan Assigned</h2>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    Your trainer hasn't assigned a diet plan yet. Please contact your trainer to get a personalized meal plan tailored to your fitness goals.
                  </p>
                  <Button variant="outline" className="mt-4" onClick={() => setContactTrainerOpen(true)} data-testid="button-contact-trainer">
                    Contact Trainer
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Header Card */}
                <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200 dark:from-green-950 dark:to-emerald-950 dark:border-green-800">
                  <CardContent className="pt-6">
                    <div className="text-center space-y-2 mb-6">
                      <div className="w-full h-2 bg-green-400 rounded-full"></div>
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Your personalized meal plan is ready</h2>
                      {currentPlan?.name && (
                        <p className="text-sm text-muted-foreground">Plan: {currentPlan.name}</p>
                      )}
                    </div>

                    {/* Day/Week Navigation */}
                    <div className="flex items-center justify-between gap-4 mb-4">
                      {Array.isArray(currentPlan?.meals) ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handlePrevWeek}
                            disabled={!hasPrevWeek}
                            data-testid="button-prev-week"
                            className="flex items-center gap-2"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            Previous
                          </Button>
                          <div className="text-center">
                            <p className="font-semibold text-gray-900 dark:text-white">
                              {currentDayLabel}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {dayMeals.length} meals
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleNextWeek}
                            disabled={!hasNextWeek}
                            data-testid="button-next-week"
                            className="flex items-center gap-2"
                          >
                            Next
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const currentIdx = DAYS_OF_WEEK.indexOf(currentDay);
                              if (currentIdx > 0) setCurrentDay(DAYS_OF_WEEK[currentIdx - 1]);
                            }}
                            disabled={DAYS_OF_WEEK.indexOf(currentDay) === 0}
                            data-testid="button-prev-day"
                            className="flex items-center gap-2"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            Previous
                          </Button>
                          <div className="text-center">
                            <p className="font-semibold text-gray-900 dark:text-white">
                              {currentDayLabel}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {dayMeals.length} meals
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const currentIdx = DAYS_OF_WEEK.indexOf(currentDay);
                              if (currentIdx < DAYS_OF_WEEK.length - 1) setCurrentDay(DAYS_OF_WEEK[currentIdx + 1]);
                            }}
                            disabled={DAYS_OF_WEEK.indexOf(currentDay) === DAYS_OF_WEEK.length - 1}
                            data-testid="button-next-day"
                            className="flex items-center gap-2"
                          >
                            Next
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>

                    {/* Total Calories Card */}
                    <div className="bg-orange-100 dark:bg-orange-900/30 rounded-lg p-4 mb-6 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Flame className="h-6 w-6 text-orange-500" />
                        <span className="font-medium text-gray-800 dark:text-gray-200">{currentDayLabel} Total Calories</span>
                      </div>
                      <span className="text-2xl font-bold text-orange-600 dark:text-orange-400">{totalCalories} Cal</span>
                    </div>

                    {/* Day Selection for multi-day plans */}
                    {typeof currentPlan?.meals === 'object' && !Array.isArray(currentPlan.meals) && (
                      <div className="mb-6 flex flex-wrap gap-2">
                        {DAYS_OF_WEEK.map((day) => (
                          <Button
                            key={day}
                            variant={currentDay === day ? "default" : "outline"}
                            size="sm"
                            onClick={() => setCurrentDay(day)}
                            disabled={!currentPlan.meals[day]}
                            data-testid={`button-day-${day}`}
                          >
                            {day.slice(0, 3)}
                          </Button>
                        ))}
                      </div>
                    )}

                    {/* Meals List */}
                    {dayMeals.length === 0 ? (
                      <Card className="border-dashed">
                        <CardContent className="p-8 text-center">
                          <UtensilsCrossed className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                          <p className="text-muted-foreground">No meals planned</p>
                          <p className="text-sm text-muted-foreground mt-1">Contact your trainer to get a meal plan</p>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-3">
                        {dayMeals.map((meal: any, idx: number) => {
                          const config = getMealTypeIcon(idx);
                          const IconComponent = config.icon;
                          return (
                            <Card 
                              key={idx} 
                              className="border-0 bg-white dark:bg-slate-800 hover-elevate cursor-pointer transition-all"
                              onClick={() => {
                                setSelectedMeal({ ...meal, mealType: config.type });
                                setShowRecipeModal(true);
                              }}
                              data-testid={`card-meal-recipe-${idx}`}
                            >
                              <CardContent className="p-4">
                                <div className="flex items-start gap-4">
                                  {/* Colored Icon Circle */}
                                  <div className={`${config.bgColor} rounded-full p-3 flex items-center justify-center`}>
                                    <IconComponent className={`h-6 w-6 ${config.iconColor}`} />
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <h4 className="font-semibold text-gray-900 dark:text-white">{meal.name}</h4>
                                      <Badge variant="outline" className="text-xs">
                                        {meal.time || config.type}
                                      </Badge>
                                    </div>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">
                                      Protein: {meal.protein}g • Carbs: {meal.carbs}g • Fats: {meal.fats}g
                                    </p>
                                  </div>
                                  <Badge variant="secondary" className="bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border-0">
                                    {meal.calories}Cal
                                  </Badge>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Day/Week Navigation Buttons */}
                {Array.isArray(currentPlan?.meals) ? (
                  <div className="flex gap-3">
                    <Button 
                      onClick={handlePrevWeek} 
                      disabled={!hasPrevWeek}
                      variant="outline"
                      className="flex-1 h-12 text-lg font-semibold"
                      data-testid="button-prev-week-bottom"
                    >
                      <ChevronLeft className="h-5 w-5 mr-2" />
                      Previous Week
                    </Button>
                    <Button 
                      onClick={handleNextWeek} 
                      disabled={!hasNextWeek}
                      className="flex-1 bg-green-500 hover:bg-green-600 h-12 text-lg font-semibold"
                      data-testid="button-next-week-bottom"
                    >
                      Next Week
                      <ChevronRight className="h-5 w-5 ml-2" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <Button 
                      onClick={() => {
                        const currentIdx = DAYS_OF_WEEK.indexOf(currentDay);
                        if (currentIdx > 0) setCurrentDay(DAYS_OF_WEEK[currentIdx - 1]);
                      }}
                      disabled={DAYS_OF_WEEK.indexOf(currentDay) === 0}
                      variant="outline"
                      className="flex-1 h-12 text-lg font-semibold"
                      data-testid="button-prev-day-bottom"
                    >
                      <ChevronLeft className="h-5 w-5 mr-2" />
                      Previous Day
                    </Button>
                    <Button 
                      onClick={() => {
                        const currentIdx = DAYS_OF_WEEK.indexOf(currentDay);
                        if (currentIdx < DAYS_OF_WEEK.length - 1) setCurrentDay(DAYS_OF_WEEK[currentIdx + 1]);
                      }}
                      disabled={DAYS_OF_WEEK.indexOf(currentDay) === DAYS_OF_WEEK.length - 1}
                      className="flex-1 bg-green-500 hover:bg-green-600 h-12 text-lg font-semibold"
                      data-testid="button-next-day-bottom"
                    >
                      Next Day
                      <ChevronRight className="h-5 w-5 ml-2" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Macros Tab */}
          <TabsContent value="macros" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{currentDayLabel} Macros & Goals</CardTitle>
                    <Badge className="mt-2 bg-orange-500">Premium</Badge>
                  </div>
                  <Badge variant="outline" className="text-green-600 dark:text-green-400">
                    Lose Weight
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Circular Calories Progress */}
                <div className="flex items-center justify-between">
                  <div className="flex flex-col items-center">
                    <div className="relative w-32 h-32 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                      {/* Circular Progress */}
                      <svg className="absolute w-32 h-32" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="8" className="text-gray-200 dark:text-gray-700" />
                        <circle
                          cx="60"
                          cy="60"
                          r="54"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          className="text-orange-500"
                          strokeDasharray={`${(caloriePercent / 100) * (2 * Math.PI * 54)} ${2 * Math.PI * 54}`}
                          strokeLinecap="round"
                          transform="rotate(-90 60 60)"
                        />
                      </svg>
                      <div className="text-center z-10">
                        <div className="text-3xl font-bold text-gray-900 dark:text-white">{remainingCalories}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">Remaining</div>
                      </div>
                    </div>
                  </div>

                  {/* Right Side Stats */}
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">{currentDayLabel} Goal</div>
                      <div className="text-2xl font-bold text-gray-900 dark:text-white">{calorieGoal}</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <UtensilsCrossed className="h-4 w-4 text-orange-500" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">Meals</span>
                      </div>
                      <div className="text-lg font-semibold text-gray-900 dark:text-white">{dailyCalories}</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-blue-500" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">Progress</span>
                      </div>
                      <div className="text-lg font-semibold text-gray-900 dark:text-white">{Math.round(caloriePercent)}%</div>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Macros Breakdown */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
                    <div className="text-2xl">🌾</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Carbs</div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">{totalCarbs}g</div>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-center">
                    <div className="text-2xl">🍗</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Protein</div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">{totalProtein}g</div>
                  </div>
                  <div className="bg-yellow-50 dark:bg-yellow-950/30 rounded-lg p-3 text-center">
                    <div className="text-2xl">🧈</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Fat</div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">{totalFats}g</div>
                  </div>
                  <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 text-center">
                    <div className="text-2xl">🥬</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Fiber</div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">38g</div>
                  </div>
                </div>

                <Separator />

                {/* Weekly Report */}
                <div className="space-y-3">
                  <Card className="hover-elevate cursor-pointer" onClick={handleDietaryReport} data-testid="button-dietary-report">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">📊</span>
                        <span className="font-semibold">{currentDayLabel} Dietary Report</span>
                      </div>
                      <Button variant="ghost" size="icon" data-testid="button-report-icon">
                        <TrendingDown className="h-5 w-5" />
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Substitutions Tab */}
          <TabsContent value="substitutions" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5" />
                  Meal Substitutions
                </CardTitle>
                <CardDescription>Swap meals for alternatives that match your nutritional goals</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {dayMeals.length === 0 ? (
                  <p className="text-muted-foreground">No meals to substitute. Load your meal plan first.</p>
                ) : (
                  <div className="space-y-3">
                    {dayMeals.map((meal: any, idx: number) => (
                      <Card key={idx} className="p-4 border-dashed">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex-1">
                            <p className="font-semibold">{meal.name}</p>
                            <p className="text-sm text-muted-foreground">{meal.calories} Cal • {meal.protein}g Protein</p>
                          </div>
                          <Button variant="outline" size="sm" data-testid={`button-substitute-meal-${idx}`}>
                            Suggest Alternatives
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Allergens Tab */}
          <TabsContent value="allergens" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Food Allergies & Preferences
                </CardTitle>
                <CardDescription>Mark your allergens to filter safe meals</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <Label className="text-base font-semibold mb-3 block">Your Allergens</Label>
                    <div className="flex flex-wrap gap-2">
                      {clientAllergens.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No allergens set yet</p>
                      ) : (
                        clientAllergens.map((allergen, idx) => (
                          <Badge key={idx} variant="secondary" className="bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                            {allergen}
                            <button
                              onClick={() => {
                                const updated = clientAllergens.filter((_, i) => i !== idx);
                                setClientAllergens(updated);
                                localStorage.setItem('clientAllergens', JSON.stringify(updated));
                              }}
                              className="ml-2 hover:opacity-70"
                              data-testid={`button-remove-allergen-${idx}`}
                            >
                              ×
                            </button>
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <Label className="text-base font-semibold mb-3 block">Meals Status</Label>
                    <div className="space-y-2">
                      {dayMeals.map((meal: any, idx: number) => {
                        const hasAllergen = mealHasAllergens(meal);
                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg flex items-center justify-between ${
                              hasAllergen
                                ? 'bg-red-50 dark:bg-red-950/30'
                                : 'bg-green-50 dark:bg-green-950/30'
                            }`}
                            data-testid={`card-meal-allergen-${idx}`}
                          >
                            <div>
                              <p className="font-semibold">{meal.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {hasAllergen ? 'Contains potential allergen' : 'Safe to eat'}
                              </p>
                            </div>
                            {hasAllergen && (
                              <AlertTriangle className="h-5 w-5 text-red-600" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Grocery List Tab */}
          <TabsContent value="grocery" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Grocery List
                </CardTitle>
                <CardDescription>Auto-generated from {currentDayLabel} meals</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  onClick={() => setShowGroceryModal(true)}
                  className="w-full"
                  data-testid="button-generate-grocery-list"
                >
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Generate Shopping List
                </Button>

                {dayMeals.length > 0 && (
                  <div className="space-y-3">
                    {Object.entries(generateGroceryList()).map(([category, items]: [string, any]) => (
                      <Card key={category} className="p-3">
                        <p className="font-semibold text-sm mb-2">{category}</p>
                        <ul className="space-y-1">
                          {items.map((item: any, idx: number) => (
                            <li key={idx} className="text-sm text-muted-foreground flex items-center gap-2">
                              <input type="checkbox" className="w-4 h-4" data-testid={`checkbox-grocery-item-${idx}`} />
                              {item.name} ({item.quantity} {item.unit})
                            </li>
                          ))}
                        </ul>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Supplements Tab */}
          <TabsContent value="supplements" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Pill className="h-5 w-5" />
                  Supplement Tracker
                </CardTitle>
                <CardDescription>Log your daily supplements, vitamins, and protein shakes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <Label htmlFor="supp-name">Supplement Name</Label>
                    <input
                      id="supp-name"
                      type="text"
                      placeholder="e.g., Whey Protein, Vitamin D"
                      value={newSupplement.name}
                      onChange={(e) => setNewSupplement({ ...newSupplement, name: e.target.value })}
                      className="w-full mt-1 px-3 py-2 border rounded-lg bg-background"
                      data-testid="input-supplement-name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="supp-dosage">Dosage</Label>
                      <input
                        id="supp-dosage"
                        type="text"
                        placeholder="e.g., 25g"
                        value={newSupplement.dosage}
                        onChange={(e) => setNewSupplement({ ...newSupplement, dosage: e.target.value })}
                        className="w-full mt-1 px-3 py-2 border rounded-lg bg-background"
                        data-testid="input-supplement-dosage"
                      />
                    </div>
                    <div>
                      <Label htmlFor="supp-timing">Timing</Label>
                      <input
                        id="supp-timing"
                        type="text"
                        placeholder="e.g., Post-Workout"
                        value={newSupplement.timing}
                        onChange={(e) => setNewSupplement({ ...newSupplement, timing: e.target.value })}
                        className="w-full mt-1 px-3 py-2 border rounded-lg bg-background"
                        data-testid="input-supplement-timing"
                      />
                    </div>
                  </div>
                  <Button onClick={addSupplementLog} className="w-full" data-testid="button-log-supplement">
                    <Plus className="h-4 w-4 mr-2" />
                    Log Supplement
                  </Button>
                </div>

                {supplementLog.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-semibold text-sm">Today's Log</p>
                    {supplementLog.map((log, idx) => (
                      <Card key={idx} className="p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-sm">{log.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {log.dosage} • {log.timing} • {log.timestamp}
                            </p>
                          </div>
                          <Check className="h-5 w-5 text-green-600" />
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Dietary Report Dialog */}
      <Dialog open={showDietaryReport} onOpenChange={setShowDietaryReport}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <TrendingDown className="h-6 w-6 text-green-600" />
              {currentDayLabel} Dietary Report
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Weekly Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{currentDayLabel} Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Total Calories</p>
                    <p className="text-2xl font-bold text-orange-600">{totalCalories} Cal</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Daily Goal</p>
                    <p className="text-2xl font-bold text-orange-600">{calorieGoal} Cal</p>
                  </div>
                </div>
                
                <Separator />
                
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-red-50 dark:bg-red-950/30 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Protein</p>
                    <p className="text-lg font-bold">{totalProtein}g</p>
                  </div>
                  <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Carbs</p>
                    <p className="text-lg font-bold">{totalCarbs}g</p>
                  </div>
                  <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Fats</p>
                    <p className="text-lg font-bold">{totalFats}g</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Meal Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Meal Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {dayMeals.map((meal: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{meal.name}</p>
                        <p className="text-sm text-muted-foreground">{meal.time}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-orange-600">{meal.calories} Cal</p>
                        <p className="text-xs text-muted-foreground">
                          P: {meal.protein}g • C: {meal.carbs}g • F: {meal.fats}g
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Progress Towards Goal */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Progress Towards Goal</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Daily Total vs Goal</span>
                    <span className="text-sm font-medium">{Math.round(caloriePercent)}%</span>
                  </div>
                  <Progress value={caloriePercent} className="h-3" />
                  <p className="text-xs text-muted-foreground mt-2">
                    Target: {calorieGoal} Cal/day • Current: {dailyCalories} Cal/day
                  </p>
                </div>
                
                {remainingCalories > 0 ? (
                  <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                    <Check className="h-5 w-5 text-green-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-green-900 dark:text-green-100">On Track!</p>
                      <p className="text-sm text-green-700 dark:text-green-300">
                        You're {remainingCalories} calories below your daily goal. Great job!
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-orange-900 dark:text-orange-100">Above Goal</p>
                      <p className="text-sm text-orange-700 dark:text-orange-300">
                        You're {Math.abs(remainingCalories)} calories over your daily goal.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </DialogContent>
      </Dialog>
      <ContactTrainerDialog open={contactTrainerOpen} onOpenChange={setContactTrainerOpen} />

      {/* Recipe Details Modal */}
      <Dialog open={showRecipeModal} onOpenChange={setShowRecipeModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Utensils className="h-5 w-5" />
              {selectedMeal?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Macro Summary */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-orange-50 dark:bg-orange-950/30 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Calories</p>
                <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{selectedMeal?.calories}</p>
              </div>
              <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Protein</p>
                <p className="text-lg font-bold text-red-600 dark:text-red-400">{selectedMeal?.protein}g</p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Carbs</p>
                <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{selectedMeal?.carbs}g</p>
              </div>
              <div className="bg-yellow-50 dark:bg-yellow-950/30 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Fats</p>
                <p className="text-lg font-bold text-yellow-600 dark:text-yellow-400">{selectedMeal?.fats}g</p>
              </div>
            </div>

            <Separator />

            {/* Ingredients */}
            {selectedMeal?.dishes && selectedMeal.dishes.length > 0 && (
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <Apple className="h-5 w-5" />
                  Ingredients
                </h3>
                <div className="space-y-2">
                  {selectedMeal.dishes.map((dish: any, idx: number) => (
                    <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                      <p className="font-medium">{dish.name}</p>
                      {dish.description && (
                        <p className="text-sm text-muted-foreground mt-1">{dish.description}</p>
                      )}
                      <div className="flex gap-4 mt-2 text-xs">
                        {dish.calories && <span>Calories: {dish.calories}</span>}
                        {dish.protein && <span>Protein: {dish.protein}g</span>}
                        {dish.carbs && <span>Carbs: {dish.carbs}g</span>}
                        {dish.fats && <span>Fats: {dish.fats}g</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Instructions */}
            {selectedMeal?.instructions && (
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <ChefHat className="h-5 w-5" />
                  Preparation Instructions
                </h3>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm whitespace-pre-wrap">{selectedMeal.instructions}</p>
                </div>
              </div>
            )}

            {/* Meal Type Badge */}
            <div className="flex items-center gap-2">
              <Badge>{selectedMeal?.mealType || 'Meal'}</Badge>
              {selectedMeal?.time && (
                <Badge variant="outline">{selectedMeal.time}</Badge>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <MobileNavigation />
    </div>
  );
}
