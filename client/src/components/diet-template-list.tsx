import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Plus, Search, Edit, Trash2, Copy, UserPlus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AssignPlanDialog } from "@/components/assign-plan-dialog";

const DIET_CATEGORIES = [
  { value: 'weight_loss', label: 'Weight Loss' },
  { value: 'weight_gain', label: 'Weight Gain (Bulk)' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'keto', label: 'Ketogenic' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'vegetarian', label: 'Vegetarian' },
];

const DAYS_OF_WEEK = [
  { value: 'Monday', label: 'Monday' },
  { value: 'Tuesday', label: 'Tuesday' },
  { value: 'Wednesday', label: 'Wednesday' },
  { value: 'Thursday', label: 'Thursday' },
  { value: 'Friday', label: 'Friday' },
  { value: 'Saturday', label: 'Saturday' },
  { value: 'Sunday', label: 'Sunday' },
];

interface Dish {
  name: string;
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

interface Meal {
  type: string;
  dishes: Dish[];
}

interface DietTemplateFormData {
  name: string;
  description: string;
  category: string;
  targetCalories: string;
  meals: Record<string, Meal[]>;
  selectedDay: string;
}

const MEAL_TYPES = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'preworkout', label: 'Pre-Workout' },
  { value: 'postworkout', label: 'Post-Workout' },
  { value: 'dinner', label: 'Dinner' },
];

export function DietTemplateList({ isTrainer = false, trainerId = '' }: { isTrainer?: boolean; trainerId?: string }) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [formData, setFormData] = useState<DietTemplateFormData>({
    name: "",
    description: "",
    category: "weight_loss",
    targetCalories: "",
    meals: {},
    selectedDay: "Monday",
  });
  const [selectedMealTypes, setSelectedMealTypes] = useState<string[]>([]);

  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/diet-plan-templates', categoryFilter],
    queryFn: async () => {
      const params = categoryFilter !== "all" ? `?category=${categoryFilter}` : '';
      const res = await fetch(`/api/diet-plan-templates${params}`);
      if (!res.ok) throw new Error('Failed to fetch diet templates');
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/diet-plans", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/diet-plan-templates'] });
      toast({ title: "Success", description: "Diet template created successfully" });
      setEditDialogOpen(false);
      setEditingTemplate(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => 
      apiRequest("PATCH", `/api/diet-plans/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/diet-plan-templates'] });
      toast({ title: "Success", description: "Diet template updated successfully" });
      setEditDialogOpen(false);
      setEditingTemplate(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/diet-plans/${id}/clone`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/diet-plan-templates'] });
      toast({ title: "Success", description: "Diet template cloned successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/diet-plans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/diet-plan-templates'] });
      toast({ title: "Success", description: "Diet template deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      category: "weight_loss",
      targetCalories: "",
      meals: {},
      selectedDay: "Monday",
    });
    setSelectedMealTypes([]);
  };

  const handleEdit = (template: any) => {
    setEditingTemplate(template);
    
    // Convert object-based meals back to editable format for multi-day support
    const mealsObject: Record<string, Meal[]> = {};
    let firstDay = "Monday";
    let mealsForFirstDay: Meal[] = [];
    
    if (template.meals && typeof template.meals === 'object' && !Array.isArray(template.meals)) {
      // Extract from day-based structure (e.g., { Monday: { breakfast: {...} } })
      const days = Object.keys(template.meals);
      if (days.length > 0) {
        firstDay = days[0];
        const dayMeals = template.meals[firstDay];
        mealsForFirstDay = Object.keys(dayMeals).map(type => ({
          type,
          dishes: dayMeals[type].dishes || []
        }));
        
        // Convert all days to record format
        days.forEach(day => {
          const dayData = template.meals[day];
          mealsObject[day] = Object.keys(dayData).map(type => ({
            type,
            dishes: dayData[type].dishes || []
          }));
        });
      }
    }
    
    setFormData({
      name: template.name,
      description: template.description ?? "",
      category: template.category ?? "weight_loss",
      targetCalories: String(template.targetCalories ?? ""),
      meals: mealsObject,
      selectedDay: firstDay,
    });
    const mealTypes = mealsForFirstDay.map((m: any) => m.type);
    setSelectedMealTypes(mealTypes);
    setEditDialogOpen(true);
  };

  const toggleMealType = (mealType: string) => {
    const dayMeals = formData.meals[formData.selectedDay] || [];
    
    if (selectedMealTypes.includes(mealType)) {
      setSelectedMealTypes(selectedMealTypes.filter(t => t !== mealType));
      setFormData({
        ...formData,
        meals: {
          ...formData.meals,
          [formData.selectedDay]: dayMeals.filter(m => m.type !== mealType)
        }
      });
    } else {
      setSelectedMealTypes([...selectedMealTypes, mealType]);
      setFormData({
        ...formData,
        meals: {
          ...formData.meals,
          [formData.selectedDay]: [...dayMeals, { type: mealType, dishes: [] }]
        }
      });
    }
  };

  const addDishToMeal = (mealType: string) => {
    const newDish: Dish = {
      name: "",
      description: "",
      calories: 0,
      protein: 0,
      carbs: 0,
      fats: 0,
    };
    const dayMeals = formData.meals[formData.selectedDay] || [];
    setFormData({
      ...formData,
      meals: {
        ...formData.meals,
        [formData.selectedDay]: dayMeals.map(meal =>
          meal.type === mealType
            ? { ...meal, dishes: [...meal.dishes, newDish] }
            : meal
        )
      }
    });
  };

  const updateDish = (mealType: string, dishIndex: number, field: keyof Dish, value: any) => {
    const dayMeals = formData.meals[formData.selectedDay] || [];
    setFormData({
      ...formData,
      meals: {
        ...formData.meals,
        [formData.selectedDay]: dayMeals.map(meal =>
          meal.type === mealType
            ? {
                ...meal,
                dishes: meal.dishes.map((dish, idx) => {
                  if (idx === dishIndex) {
                    const updatedDish = { ...dish, [field]: value };
                    // Auto-calculate calories when macros change
                    if (field === 'protein' || field === 'carbs' || field === 'fats') {
                      const protein = field === 'protein' ? value : dish.protein;
                      const carbs = field === 'carbs' ? value : dish.carbs;
                      const fats = field === 'fats' ? value : dish.fats;
                      updatedDish.calories = Math.round((protein * 4) + (carbs * 4) + (fats * 9));
                    }
                    return updatedDish;
                  }
                  return dish;
                })
              }
            : meal
        )
      }
    });
  };

  const removeDish = (mealType: string, dishIndex: number) => {
    const dayMeals = formData.meals[formData.selectedDay] || [];
    setFormData({
      ...formData,
      meals: {
        ...formData.meals,
        [formData.selectedDay]: dayMeals.map(meal =>
          meal.type === mealType
            ? { ...meal, dishes: meal.dishes.filter((_, idx) => idx !== dishIndex) }
            : meal
        )
      }
    });
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "Please enter a template name", variant: "destructive" });
      return;
    }

    const targetCalories = parseFloat(formData.targetCalories);
    if (isNaN(targetCalories) || targetCalories <= 0) {
      toast({ title: "Error", description: "Please enter valid target calories (greater than 0)", variant: "destructive" });
      return;
    }

    // Build meals object for all selected days
    const mealsObject: any = {};
    
    Object.entries(formData.meals).forEach(([day, dayMeals]) => {
      mealsObject[day] = {};
      dayMeals.forEach((meal) => {
        // Aggregate calories and macros from dishes
        const totalCalories = meal.dishes.reduce((sum, dish) => sum + (dish.calories || 0), 0);
        const totalProtein = meal.dishes.reduce((sum, dish) => sum + (dish.protein || 0), 0);
        const totalCarbs = meal.dishes.reduce((sum, dish) => sum + (dish.carbs || 0), 0);
        const totalFats = meal.dishes.reduce((sum, dish) => sum + (dish.fats || 0), 0);
        
        mealsObject[day][meal.type] = {
          name: meal.dishes.map(d => d.name).filter(Boolean).join(', ') || `${meal.type} meal`,
          dishes: meal.dishes,
          calories: totalCalories,
          protein: totalProtein,
          carbs: totalCarbs,
          fats: totalFats,
        };
      });
    });

    const submitData = {
      name: formData.name,
      description: formData.description,
      category: formData.category,
      targetCalories,
      isTemplate: true,
      meals: mealsObject,
    };

    if (editingTemplate) {
      updateMutation.mutate({ 
        id: editingTemplate._id, 
        data: submitData
      });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const filteredTemplates = templates.filter((template) => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === "all" || template.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search diet templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-diet-templates"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-diet-category-filter">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {DIET_CATEGORIES.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button 
          onClick={() => {
            setEditingTemplate(null);
            resetForm();
            setEditDialogOpen(true);
          }}
          data-testid="button-create-diet-template"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Diet
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading diet templates...</div>
      ) : filteredTemplates.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No diet templates found</p>
          <p className="text-sm text-muted-foreground mt-2">Create Your First Diet Template</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => (
            <Card key={template._id} data-testid={`card-diet-template-${template._id}`}>
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2">{template.name}</span>
                  <div className="flex gap-1 flex-wrap">
                    {template.templateSource === 'admin' && (
                      <Badge variant="secondary">Admin Template</Badge>
                    )}
                    {template.templateSource === 'trainer' && (
                      <Badge variant="secondary">Trainer Template</Badge>
                    )}
                    {template.category && (
                      <Badge variant="default">
                        {DIET_CATEGORIES.find(c => c.value === template.category)?.label || template.category}
                      </Badge>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {template.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{template.description}</p>
                )}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Calories</span>
                    <span className="font-semibold">{template.targetCalories || 0} cal</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Assigned</span>
                    <span className="font-semibold">{template.assignedCount || 0} times</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant="default" 
                    size="sm"
                    onClick={() => {
                      setSelectedPlan(template);
                      setAssignDialogOpen(true);
                    }}
                    data-testid={`button-assign-${template._id}`}
                  >
                    <UserPlus className="h-3 w-3 mr-1" />
                    Assign
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => cloneMutation.mutate(template._id)}
                    data-testid={`button-clone-${template._id}`}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Clone
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleEdit(template)}
                    data-testid={`button-edit-${template._id}`}
                  >
                    <Edit className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => deleteMutation.mutate(template._id)}
                    data-testid={`button-delete-${template._id}`}
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

      <AssignPlanDialog
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        plan={selectedPlan}
      />

      <Dialog open={editDialogOpen} onOpenChange={(open) => {
        setEditDialogOpen(open);
        if (!open) {
          setEditingTemplate(null);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Diet Template" : "Create Diet Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name *</Label>
              <Input
                id="template-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., High Protein Weight Loss"
                data-testid="input-template-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-description">Description</Label>
              <Textarea
                id="template-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe this diet plan template..."
                rows={3}
                data-testid="textarea-template-description"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-category">Category *</Label>
              <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                <SelectTrigger id="template-category" data-testid="select-template-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIET_CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="selected-day">Day of Week *</Label>
              <Select value={formData.selectedDay} onValueChange={(value) => setFormData({ ...formData, selectedDay: value })}>
                <SelectTrigger id="selected-day" data-testid="select-day">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_WEEK.map(day => (
                    <SelectItem key={day.value} value={day.value}>{day.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Select which day this meal plan is for</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="target-calories">Target Calories *</Label>
              <Input
                id="target-calories"
                type="number"
                value={formData.targetCalories}
                onChange={(e) => setFormData({ ...formData, targetCalories: e.target.value })}
                placeholder="0"
                data-testid="input-target-calories"
              />
            </div>

            <Separator className="my-6" />

            <div className="space-y-4">
              <div>
                <Label className="text-base font-semibold">Day Selection</Label>
                <p className="text-sm text-muted-foreground mt-1">Click to select a day and add meals for that day</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {DAYS_OF_WEEK.map(day => (
                    <Button
                      key={day.value}
                      variant={formData.selectedDay === day.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setFormData({ ...formData, selectedDay: day.value });
                        // Update selected meal types based on current day
                        const dayMeals = formData.meals[day.value] || [];
                        setSelectedMealTypes(dayMeals.map(m => m.type));
                      }}
                      data-testid={`button-select-day-${day.value}`}
                    >
                      {day.label}
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              <div>
                <Label className="text-base font-semibold">Meal Planning for {formData.selectedDay}</Label>
                <p className="text-sm text-muted-foreground mt-1">Select meal types and add dishes with their nutritional information</p>
              </div>

              <div className="space-y-3">
                {MEAL_TYPES.map((mealType) => (
                  <div key={mealType.value} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={selectedMealTypes.includes(mealType.value)}
                          onCheckedChange={() => toggleMealType(mealType.value)}
                          data-testid={`switch-${mealType.value}`}
                        />
                        <Label className="font-medium">{mealType.label}</Label>
                      </div>
                      {selectedMealTypes.includes(mealType.value) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addDishToMeal(mealType.value)}
                          data-testid={`button-add-dish-${mealType.value}`}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add Dish
                        </Button>
                      )}
                    </div>

                    {selectedMealTypes.includes(mealType.value) && (
                      <div className="ml-6 space-y-3">
                        {(formData.meals[formData.selectedDay] || [])
                          .find((m: any) => m.type === mealType.value)
                          ?.dishes.map((dish: any, dishIndex: any) => (
                            <Card key={dishIndex} className="p-4">
                              <div className="space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                      <div className="space-y-1">
                                        <Label className="text-xs">Dish Name *</Label>
                                        <Input
                                          value={dish.name}
                                          onChange={(e) => updateDish(mealType.value, dishIndex, 'name', e.target.value)}
                                          placeholder="e.g., Scrambled Eggs"
                                          data-testid={`input-dish-name-${mealType.value}-${dishIndex}`}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs">Calories (auto)</Label>
                                        <Input
                                          type="number"
                                          value={dish.calories}
                                          readOnly
                                          disabled
                                          placeholder="0"
                                          className="bg-muted"
                                          data-testid={`input-dish-calories-${mealType.value}-${dishIndex}`}
                                        />
                                      </div>
                                    </div>

                                    <div className="space-y-1">
                                      <Label className="text-xs">Description</Label>
                                      <Textarea
                                        value={dish.description}
                                        onChange={(e) => updateDish(mealType.value, dishIndex, 'description', e.target.value)}
                                        placeholder="Short description of the dish..."
                                        rows={2}
                                        data-testid={`textarea-dish-description-${mealType.value}-${dishIndex}`}
                                      />
                                    </div>

                                    <div className="grid grid-cols-3 gap-2">
                                      <div className="space-y-1">
                                        <Label className="text-xs">Protein (g)</Label>
                                        <Input
                                          type="number"
                                          value={dish.protein}
                                          onChange={(e) => updateDish(mealType.value, dishIndex, 'protein', parseFloat(e.target.value) || 0)}
                                          placeholder="0"
                                          data-testid={`input-dish-protein-${mealType.value}-${dishIndex}`}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs">Carbs (g)</Label>
                                        <Input
                                          type="number"
                                          value={dish.carbs}
                                          onChange={(e) => updateDish(mealType.value, dishIndex, 'carbs', parseFloat(e.target.value) || 0)}
                                          placeholder="0"
                                          data-testid={`input-dish-carbs-${mealType.value}-${dishIndex}`}
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs">Fats (g)</Label>
                                        <Input
                                          type="number"
                                          value={dish.fats}
                                          onChange={(e) => updateDish(mealType.value, dishIndex, 'fats', parseFloat(e.target.value) || 0)}
                                          placeholder="0"
                                          data-testid={`input-dish-fats-${mealType.value}-${dishIndex}`}
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeDish(mealType.value, dishIndex)}
                                    data-testid={`button-remove-dish-${mealType.value}-${dishIndex}`}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </Card>
                          ))}
                        {(formData.meals[formData.selectedDay] || []).find((m: any) => m.type === mealType.value)?.dishes.length === 0 && (
                          <p className="text-sm text-muted-foreground italic">No dishes added yet. Click "Add Dish" to get started.</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setEditDialogOpen(false);
                  setEditingTemplate(null);
                  resetForm();
                }}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={updateMutation.isPending || createMutation.isPending}
                data-testid="button-save-template"
              >
                {(updateMutation.isPending || createMutation.isPending) 
                  ? "Saving..." 
                  : editingTemplate ? "Save Changes" : "Create Diet"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
