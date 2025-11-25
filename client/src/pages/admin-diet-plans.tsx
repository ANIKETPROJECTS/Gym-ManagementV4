import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Users,
  Copy,
  Edit,
  Trash2,
  Search,
  UtensilsCrossed,
  Filter,
  BookOpen,
  ChefHat,
  Dumbbell,
} from "lucide-react";
import { CreateDietPlanModal } from "@/components/create-diet-plan-modal";
import { MealBuilderModal } from "@/components/meal-builder-modal";
import { AssignPlanDialog } from "@/components/assign-plan-dialog";

export default function AdminDietPlans() {
  const style = { "--sidebar-width": "16rem" };
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [workoutCategoryFilter, setWorkoutCategoryFilter] = useState<string>("all");
  const [mealCategoryFilter, setMealCategoryFilter] = useState<string>("all");
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [createMealOpen, setCreateMealOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [editingMeal, setEditingMeal] = useState<any>(null);
  const [createWorkoutOpen, setCreateWorkoutOpen] = useState(false);
  const [selectedWorkout, setSelectedWorkout] = useState<any>(null);
  const [assignMode, setAssignMode] = useState<'assign' | 'reassign'>('assign');

  const { data: currentUser } = useQuery<any>({
    queryKey: ['/api/auth/me'],
  });

  const isAdmin = currentUser?.role === 'admin';
  const isTrainer = currentUser?.role === 'trainer';

  const { data: templates = [], isLoading: templatesLoading } = useQuery<any[]>({
    queryKey: ['/api/diet-plan-templates', categoryFilter],
    queryFn: async () => {
      const params = categoryFilter !== 'all' ? `?category=${categoryFilter}` : '';
      const res = await fetch(`/api/diet-plan-templates${params}`);
      return res.json();
    },
  });

  const { data: meals = [], isLoading: mealsLoading } = useQuery<any[]>({
    queryKey: ['/api/meals', searchQuery, mealCategoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (mealCategoryFilter && mealCategoryFilter !== 'all') params.append('mealType', mealCategoryFilter);
      const queryString = params.toString();
      const res = await fetch(`/api/meals${queryString ? `?${queryString}` : ''}`);
      return res.json();
    },
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<any[]>({
    queryKey: ['/api/diet-plans-with-assignments'],
    enabled: !!currentUser, // Only run query when user is loaded
  });

  const { data: workoutPlans = [], isLoading: workoutPlansLoading } = useQuery<any[]>({
    queryKey: ['/api/workout-plans', searchQuery, workoutCategoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (workoutCategoryFilter && workoutCategoryFilter !== 'all') params.append('category', workoutCategoryFilter);
      const queryString = params.toString();
      const res = await fetch(`/api/workout-plans${queryString ? `?${queryString}` : ''}`);
      return res.json();
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      return apiRequest('DELETE', `/api/diet-plans/${planId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/diet-plan-templates'] });
      toast({
        title: "Success",
        description: "Diet plan deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete diet plan",
        variant: "destructive",
      });
    },
  });

  const deleteMealMutation = useMutation({
    mutationFn: async (mealId: string) => {
      return apiRequest('DELETE', `/api/meals/${mealId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/meals'] });
      toast({
        title: "Success",
        description: "Meal deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete meal",
        variant: "destructive",
      });
    },
  });

  const clonePlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      return apiRequest('POST', `/api/diet-plans/${planId}/clone`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/diet-plan-templates'] });
      toast({
        title: "Success",
        description: "Diet plan cloned successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to clone diet plan",
        variant: "destructive",
      });
    },
  });

  const deleteWorkoutMutation = useMutation({
    mutationFn: async (workoutId: string) => {
      return apiRequest('DELETE', `/api/workout-plans/${workoutId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/workout-plans'] });
      toast({
        title: "Success",
        description: "Workout plan deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete workout plan",
        variant: "destructive",
      });
    },
  });

  const handleAssign = (plan: any) => {
    setSelectedPlan(plan);
    setAssignDialogOpen(true);
  };

  const handleClone = (planId: string) => {
    clonePlanMutation.mutate(planId);
  };

  const handleDelete = (planId: string) => {
    if (confirm("Are you sure you want to delete this diet plan?")) {
      deletePlanMutation.mutate(planId);
    }
  };

  const handleDeleteMeal = (mealId: string) => {
    if (confirm("Are you sure you want to delete this meal?")) {
      deleteMealMutation.mutate(mealId);
    }
  };

  const handleEditMeal = (meal: any) => {
    setEditingMeal(meal);
    setCreateMealOpen(true);
  };

  const handleDeleteWorkout = (workoutId: string) => {
    if (confirm("Are you sure you want to delete this workout plan?")) {
      deleteWorkoutMutation.mutate(workoutId);
    }
  };

  const filteredTemplates = templates.filter(plan =>
    plan.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const categories = [
    "Low Carb",
    "High Protein",
    "Ketogenic",
    "Vegan",
    "Balanced",
    "Paleo",
    "Mediterranean",
  ];

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AdminSidebar />
        <div className="flex flex-col flex-1">
          <header className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-4">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <h1 className="text-2xl font-display font-bold tracking-tight flex items-center gap-2">
                <UtensilsCrossed className="h-6 w-6" />
                Diet Plan Management
              </h1>
            </div>
            <ThemeToggle />
          </header>

          <main className="flex-1 overflow-auto p-8 bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/20 dark:to-blue-900/10">
            <div className="max-w-7xl mx-auto space-y-6">
              <Tabs defaultValue="templates" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="templates" data-testid="tab-templates">
                    <BookOpen className="h-4 w-4 mr-2" />
                    Diet Templates
                  </TabsTrigger>
                  <TabsTrigger value="meals" data-testid="tab-meals">
                    <ChefHat className="h-4 w-4 mr-2" />
                    Meal Database
                  </TabsTrigger>
                  <TabsTrigger value="workouts" data-testid="tab-workouts">
                    <Dumbbell className="h-4 w-4 mr-2" />
                    Workout Plans
                  </TabsTrigger>
                  <TabsTrigger value="assignments" data-testid="tab-assignments">
                    <Users className="h-4 w-4 mr-2" />
                    Assignments
                  </TabsTrigger>
                </TabsList>

                {/* Plan Templates Tab */}
                <TabsContent value="templates" className="space-y-6 mt-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search diet plans..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-10"
                          data-testid="input-search-plans"
                        />
                      </div>
                      <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger className="w-48" data-testid="select-category-filter">
                          <Filter className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          {categories.map((cat) => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      onClick={() => {
                        setSelectedPlan(null);
                        setCreatePlanOpen(true);
                      }}
                      data-testid="button-create-template"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create Template
                    </Button>
                  </div>

                  {templatesLoading ? (
                    <div className="text-center py-12 text-muted-foreground">Loading templates...</div>
                  ) : filteredTemplates.length === 0 ? (
                    <div className="text-center py-12">
                      <UtensilsCrossed className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">No diet plan templates found</p>
                      <Button onClick={() => setCreatePlanOpen(true)} className="mt-4" variant="outline">
                        Create Your First Template
                      </Button>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {filteredTemplates.map((plan) => (
                        <Card key={plan._id} data-testid={`card-template-${plan._id}`} className="hover-elevate">
                          <CardHeader>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <CardTitle className="font-display text-lg">{plan.name}</CardTitle>
                                {plan.description && (
                                  <CardDescription className="mt-2">{plan.description}</CardDescription>
                                )}
                              </div>
                              <Badge variant="outline">{plan.category || "Balanced"}</Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Target Calories</span>
                                <span className="font-semibold">{plan.targetCalories} cal</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Protein</span>
                                <span className="font-semibold">{plan.protein || 0}g</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Carbs / Fats</span>
                                <span className="font-semibold">{plan.carbs || 0}g / {plan.fats || 0}g</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground flex items-center gap-1">
                                  <Users className="h-3 w-3" />
                                  Assigned
                                </span>
                                <span className="font-semibold">{plan.assignedCount || 0} clients</span>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAssign(plan)}
                                data-testid="button-assign"
                              >
                                <Users className="h-3 w-3 mr-1" />
                                Assign
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleClone(plan._id)}
                                data-testid="button-clone"
                              >
                                <Copy className="h-3 w-3 mr-1" />
                                Clone
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedPlan(plan);
                                  setCreatePlanOpen(true);
                                }}
                                data-testid="button-edit"
                              >
                                <Edit className="h-3 w-3 mr-1" />
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDelete(plan._id)}
                                data-testid="button-delete"
                              >
                                <Trash2 className="h-3 w-3 mr-1" />
                                Delete
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Meal Database Tab */}
                <TabsContent value="meals" className="space-y-6 mt-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search meals..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-10"
                          data-testid="input-search-meals"
                        />
                      </div>
                      <Select value={mealCategoryFilter} onValueChange={setMealCategoryFilter}>
                        <SelectTrigger className="w-48" data-testid="select-meal-category-filter">
                          <Filter className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          <SelectItem value="Breakfast">Breakfast</SelectItem>
                          <SelectItem value="Lunch">Lunch</SelectItem>
                          <SelectItem value="Dinner">Dinner</SelectItem>
                          <SelectItem value="Pre-Workout">Pre-Workout</SelectItem>
                          <SelectItem value="Post-Workout">Post-Workout</SelectItem>
                          <SelectItem value="Snack">Snack</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      onClick={() => {
                        setEditingMeal(null);
                        setCreateMealOpen(true);
                      }}
                      data-testid="button-create-meal"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Meal
                    </Button>
                  </div>

                  {mealsLoading ? (
                    <div className="text-center py-12 text-muted-foreground">Loading meals...</div>
                  ) : meals.length === 0 ? (
                    <div className="text-center py-12">
                      <ChefHat className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">No meals in database</p>
                      <Button onClick={() => setCreateMealOpen(true)} className="mt-4" variant="outline">
                        Add Your First Meal
                      </Button>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {meals.map((meal) => (
                        <Card key={meal._id} data-testid={`card-meal-${meal._id}`} className="hover-elevate">
                          <CardHeader>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <CardTitle className="font-display text-lg">{meal.name}</CardTitle>
                                <div className="flex gap-2 mt-2">
                                  <Badge variant="secondary" className="text-xs">{meal.category}</Badge>
                                  <Badge variant="outline" className="text-xs">{meal.mealType}</Badge>
                                </div>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="text-center p-2 bg-muted rounded-md">
                                <div className="font-semibold text-lg">{meal.calories}</div>
                                <div className="text-xs text-muted-foreground">Calories</div>
                              </div>
                              <div className="text-center p-2 bg-muted rounded-md">
                                <div className="font-semibold text-lg">{meal.protein}g</div>
                                <div className="text-xs text-muted-foreground">Protein</div>
                              </div>
                              <div className="text-center p-2 bg-muted rounded-md">
                                <div className="font-semibold text-lg">{meal.carbs}g</div>
                                <div className="text-xs text-muted-foreground">Carbs</div>
                              </div>
                              <div className="text-center p-2 bg-muted rounded-md">
                                <div className="font-semibold text-lg">{meal.fats}g</div>
                                <div className="text-xs text-muted-foreground">Fats</div>
                              </div>
                            </div>
                            {meal.prepTime && (
                              <div className="text-xs text-muted-foreground">
                                Prep: {meal.prepTime} min {meal.cookTime && `| Cook: ${meal.cookTime} min`}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={() => handleEditMeal(meal)}
                                data-testid="button-edit-meal"
                              >
                                <Edit className="h-3 w-3 mr-1" />
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={() => handleDeleteMeal(meal._id)}
                                data-testid="button-delete-meal"
                              >
                                <Trash2 className="h-3 w-3 mr-1" />
                                Delete
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Workout Plans Tab */}
                <TabsContent value="workouts" className="space-y-6 mt-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search workout plans..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-10"
                          data-testid="input-search-workouts"
                        />
                      </div>
                      <Select value={workoutCategoryFilter} onValueChange={setWorkoutCategoryFilter}>
                        <SelectTrigger className="w-48" data-testid="select-workout-category-filter">
                          <Filter className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          <SelectItem value="weight_loss">Weight Loss</SelectItem>
                          <SelectItem value="weight_gain">Weight Gain</SelectItem>
                          <SelectItem value="maintenance">Maintain Weight</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      onClick={() => {
                        setSelectedWorkout(null);
                        setCreateWorkoutOpen(true);
                      }}
                      data-testid="button-create-workout"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create Workout
                    </Button>
                  </div>

                  {workoutPlansLoading ? (
                    <div className="text-center py-12 text-muted-foreground">Loading workout plans...</div>
                  ) : workoutPlans.length === 0 ? (
                    <div className="text-center py-12">
                      <Dumbbell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">No workout plans found</p>
                      <Button onClick={() => setCreateWorkoutOpen(true)} className="mt-4" variant="outline">
                        Create Your First Workout Plan
                      </Button>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {workoutPlans.map((workout) => (
                        <Card key={workout._id} data-testid={`card-workout-${workout._id}`} className="hover-elevate">
                          <CardHeader>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <CardTitle className="font-display text-lg">{workout.name}</CardTitle>
                                {workout.description && (
                                  <CardDescription className="mt-2">{workout.description}</CardDescription>
                                )}
                              </div>
                              <Badge variant="outline">
                                {workout.category === 'weight_loss' ? 'Weight Loss' : 
                                 workout.category === 'weight_gain' ? 'Weight Gain' : 
                                 workout.category === 'maintenance' ? 'Maintain Weight' : 
                                 'General'}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Duration</span>
                                <span className="font-semibold">{workout.duration || workout.weeks} weeks</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Days per Week</span>
                                <span className="font-semibold">{workout.daysPerWeek || workout.schedule?.length || 0}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Focus</span>
                                <span className="font-semibold">{workout.focus || workout.type || "General"}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground flex items-center gap-1">
                                  <Users className="h-3 w-3" />
                                  Assigned
                                </span>
                                <span className="font-semibold">{workout.assignedCount || 0} clients</span>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedWorkout(workout);
                                  setCreateWorkoutOpen(true);
                                }}
                                data-testid="button-edit-workout"
                              >
                                <Edit className="h-3 w-3 mr-1" />
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteWorkout(workout._id)}
                                data-testid="button-delete-workout"
                              >
                                <Trash2 className="h-3 w-3 mr-1" />
                                Delete
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Assignments Tab */}
                <TabsContent value="assignments" className="space-y-6 mt-6">
                  {isAdmin && (
                    <div className="flex items-center justify-between mb-6 p-4 bg-muted rounded-md">
                      <div className="flex items-center gap-2">
                        <Button
                          variant={assignMode === 'assign' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setAssignMode('assign')}
                          data-testid="button-mode-assign"
                        >
                          Assign New
                        </Button>
                        <Button
                          variant={assignMode === 'reassign' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setAssignMode('reassign')}
                          data-testid="button-mode-reassign"
                        >
                          Reassign Existing
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {assignMode === 'assign' ? 'Assign new plans to clients' : 'Reassign existing plans to different clients'}
                      </p>
                    </div>
                  )}
                  
                  {assignmentsLoading ? (
                    <div className="text-center py-12 text-muted-foreground">Loading assignments...</div>
                  ) : assignments.length === 0 ? (
                    <div className="text-center py-12">
                      <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">
                        {isTrainer ? 'No diet plans assigned to your clients yet' : 'No diet plans assigned to clients yet'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {assignments.filter(plan => plan.clientId).map((plan) => (
                        <Card key={plan._id} data-testid={`card-assignment-${plan._id}`}>
                          <CardContent className="p-6">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4 flex-1">
                                <div className="flex-1">
                                  <h3 className="font-semibold">{plan.name}</h3>
                                  <p className="text-sm text-muted-foreground">
                                    Assigned to: {plan.clientId?.name || "Unknown Client"}
                                  </p>
                                </div>
                                <div className="flex gap-6 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">Calories: </span>
                                    <span className="font-semibold">{plan.targetCalories}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Category: </span>
                                    <span className="font-semibold">{plan.category || "N/A"}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant={plan.clientId?.status === 'active' ? 'default' : 'outline'}>
                                  {plan.clientId?.status || "Active"}
                                </Badge>
                                {isAdmin && (
                                  <>
                                    <Button 
                                      variant="outline" 
                                      size="sm"
                                      onClick={() => {
                                        setSelectedPlan(plan);
                                        setCreatePlanOpen(true);
                                      }}
                                      data-testid="button-edit-assignment"
                                    >
                                      <Edit className="h-3 w-3 mr-1" />
                                      Edit
                                    </Button>
                                    {assignMode === 'reassign' && (
                                      <Button 
                                        variant="outline" 
                                        size="sm"
                                        onClick={() => handleAssign(plan)}
                                        data-testid="button-reassign"
                                      >
                                        <Users className="h-3 w-3 mr-1" />
                                        Reassign
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </main>
        </div>
      </div>

      <CreateDietPlanModal
        open={createPlanOpen}
        onOpenChange={setCreatePlanOpen}
        plan={selectedPlan}
      />
      <MealBuilderModal
        open={createMealOpen}
        onOpenChange={setCreateMealOpen}
        meal={editingMeal}
      />
      <AssignPlanDialog
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        plan={selectedPlan}
      />
    </SidebarProvider>
  );
}
