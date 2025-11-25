import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ClientHeader } from "@/components/client-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Bookmark, BookmarkCheck, CheckCircle2, Clock, Dumbbell, BarChart3, FileText, AlertCircle, Loader2, GripVertical, LayoutGrid, ChevronDown, ChevronUp, Target, Flame } from "lucide-react";
import { useState } from "react";

interface WorkoutPlan {
  _id: string;
  name: string;
  description?: string;
  durationWeeks: number;
  exercises: any;
  category?: string;
  goal?: string;
  difficulty?: string;
  createdAt: string;
}

interface WorkoutSession {
  _id: string;
  workoutPlanId: string;
  workoutName: string;
  duration: number;
  completedAt: string;
  notes?: string;
}

export default function ClientWorkoutPlans() {
  const { toast } = useToast();
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [selectedPlanForLogging, setSelectedPlanForLogging] = useState<string | null>(null);
  const [sessionNotes, setSessionNotes] = useState("");
  const [sessionDuration, setSessionDuration] = useState("30");
  const [expandedNotePlanId, setExpandedNotePlanId] = useState<string | null>(null);

  // Get client ID from localStorage
  const clientId = localStorage.getItem("clientId");

  // Fetch assigned workout plans
  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-plans`],
    enabled: !!clientId,
    staleTime: 0,
    refetchInterval: 5000,
  });

  // Fetch bookmarked workout plans
  const { data: bookmarks = [], isLoading: bookmarksLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-bookmarks`],
    enabled: !!clientId,
    staleTime: 0,
    refetchInterval: 5000,
  });

  // Fetch workout history
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-history`],
    enabled: !!clientId,
    staleTime: 0,
    refetchInterval: 10000,
  });

  // Fetch workout notes
  const { data: notesMap = {}, isLoading: notesLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-notes`],
    enabled: !!clientId,
    staleTime: 0,
    refetchInterval: 10000,
  });

  // Bookmark mutation
  const bookmarkMutation = useMutation({
    mutationFn: async ({ planId, isBookmarked }: { planId: string; isBookmarked: boolean }) => {
      return apiRequest(
        isBookmarked
          ? `DELETE /api/clients/${clientId}/workout-bookmarks/${planId}`
          : `POST /api/clients/${clientId}/workout-bookmarks`,
        !isBookmarked ? { workoutPlanId: planId } : undefined
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/workout-bookmarks`] });
      toast({ description: isBookmarked ? "Bookmark removed" : "Added to bookmarks" });
    },
    onError: () => {
      toast({ description: "Failed to update bookmark", variant: "destructive" });
    },
  });

  // Session logging mutation
  const logSessionMutation = useMutation({
    mutationFn: async (data: { planId: string; duration: number; notes: string }) => {
      return apiRequest(`POST /api/clients/${clientId}/workout-history`, {
        workoutPlanId: data.planId,
        workoutName: plans.find((p: WorkoutPlan) => p._id === data.planId)?.name || "Workout",
        duration: parseInt(data.duration),
        notes: data.notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/workout-history`] });
      setSessionNotes("");
      setSessionDuration("30");
      setSelectedPlanForLogging(null);
      toast({ description: "Workout session logged successfully" });
    },
    onError: () => {
      toast({ description: "Failed to log workout session", variant: "destructive" });
    },
  });

  // Notes mutation
  const notesMutation = useMutation({
    mutationFn: async ({ planId, notes }: { planId: string; notes: string }) => {
      return apiRequest(
        notes ? `POST /api/clients/${clientId}/workout-notes` : `DELETE /api/clients/${clientId}/workout-notes/${planId}`,
        notes ? { workoutPlanId: planId, notes } : undefined
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/workout-notes`] });
      toast({ description: "Notes saved successfully" });
    },
    onError: () => {
      toast({ description: "Failed to save notes", variant: "destructive" });
    },
  });

  const isBookmarked = (planId: string) => bookmarks.some((b: any) => b.workoutPlanId === planId);
  const getPlanHistory = (planId: string) => history.filter((s: any) => s.workoutPlanId === planId);
  const getPlanNotes = (planId: string) => (notesMap as any)[planId] || "";

  if (!clientId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <p className="text-destructive">Unable to load workout plans</p>
        </div>
      </div>
    );
  }

  const getDifficultyColor = (difficulty?: string) => {
    switch (difficulty?.toLowerCase()) {
      case 'beginner': return 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200';
      case 'intermediate': return 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200';
      case 'advanced': return 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200';
      default: return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <ClientHeader currentPage="workout-history" />
      
      <main className="container mx-auto px-4 py-8">
        {plansLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : plans.length === 0 ? (
          <div>
            <h1 className="text-4xl font-bold mb-2 text-foreground">Your Workout Plans</h1>
            <p className="text-muted-foreground mb-8">Your personalized workout programs</p>
            <Card className="p-12 text-center bg-gradient-to-br from-muted/50 to-muted border-dashed">
              <Dumbbell className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium text-muted-foreground mb-2">No workout plans assigned yet</p>
              <p className="text-sm text-muted-foreground">Your trainer will assign custom workout plans here.</p>
            </Card>
          </div>
        ) : (
          <div className="space-y-8">
            {plans.map((plan: WorkoutPlan) => (
              <div key={plan._id} className="space-y-6">
                {/* Header Section */}
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-4xl font-bold text-foreground">{plan.name}</h1>
                    {plan.difficulty && (
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${getDifficultyColor(plan.difficulty)}`}>
                        {plan.difficulty.charAt(0).toUpperCase() + plan.difficulty.slice(1)}
                      </span>
                    )}
                  </div>
                  {plan.description && (
                    <p className="text-muted-foreground text-sm">{plan.description}</p>
                  )}
                </div>

                {/* Plan Stats Section */}
                <Card className="p-6 bg-muted/30 border">
                  <h2 className="text-lg font-bold text-foreground mb-6">Workout Details</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    {plan.durationWeeks && (
                      <div className="text-center">
                        <p className="text-3xl font-bold text-primary mb-2">{plan.durationWeeks}</p>
                        <p className="text-sm text-muted-foreground">Weeks Duration</p>
                      </div>
                    )}
                    {plan.category && (
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground mb-2">{plan.category}</p>
                        <p className="text-sm text-muted-foreground">Category</p>
                      </div>
                    )}
                    {plan.goal && (
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground mb-2">{plan.goal}</p>
                        <p className="text-sm text-muted-foreground">Goal</p>
                      </div>
                    )}
                    {getPlanHistory(plan._id).length > 0 && (
                      <div className="text-center">
                        <p className="text-3xl font-bold text-green-600 dark:text-green-400 mb-2">{getPlanHistory(plan._id).length}</p>
                        <p className="text-sm text-muted-foreground">Sessions Done</p>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Weekly Exercises Section */}
                {plan.exercises && Object.keys(plan.exercises).length > 0 && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-bold text-foreground">Weekly Workout Schedule</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {Object.entries(plan.exercises).map(([day, exercises]: [string, any]) => (
                        <Card key={day} className="p-4 border">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-foreground capitalize">{day}</h3>
                            {Array.isArray(exercises) && exercises.length > 0 && (
                              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs font-medium">
                                {exercises.length} exercises
                              </span>
                            )}
                          </div>
                          <div className="space-y-3">
                            {Array.isArray(exercises) && exercises.map((exercise: any, idx: number) => (
                              <div key={idx} className="border-l-2 border-primary pl-3 py-2">
                                <p className="font-semibold text-foreground text-sm">{exercise.name || exercise}</p>
                                {exercise.sets && (
                                  <p className="text-xs text-muted-foreground">
                                    {exercise.sets} sets × {exercise.reps || exercise.duration}
                                  </p>
                                )}
                              </div>
                            ))}
                            {(!Array.isArray(exercises) || exercises.length === 0) && (
                              <p className="text-sm text-muted-foreground italic">Rest day</p>
                            )}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions Section */}
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="default"
                    onClick={() => setSelectedPlanForLogging(plan._id)}
                    disabled={selectedPlanForLogging === plan._id}
                    data-testid={`button-log-workout-${plan._id}`}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Log Workout Session
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => bookmarkMutation.mutate({ planId: plan._id, isBookmarked: isBookmarked(plan._id) })}
                    data-testid={`button-bookmark-workout-${plan._id}`}
                  >
                    {isBookmarked(plan._id) ? (
                      <>
                        <BookmarkCheck className="h-4 w-4 mr-2 fill-amber-400 text-amber-400" />
                        Bookmarked
                      </>
                    ) : (
                      <>
                        <Bookmark className="h-4 w-4 mr-2" />
                        Bookmark
                      </>
                    )}
                  </Button>
                </div>

                {/* Log Session Form */}
                {selectedPlanForLogging === plan._id && (
                  <Card className="p-6 bg-primary/5 border-primary/20">
                    <h3 className="font-bold text-foreground mb-4">Log Your Session</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-foreground block mb-2">Duration (minutes)</label>
                        <input
                          type="number"
                          value={sessionDuration}
                          onChange={(e) => setSessionDuration(e.target.value)}
                          className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
                          placeholder="30"
                          data-testid={`input-duration-${plan._id}`}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground block mb-2">Notes (optional)</label>
                        <Textarea
                          value={sessionNotes}
                          onChange={(e) => setSessionNotes(e.target.value)}
                          placeholder="How did it feel? Any modifications?"
                          className="min-h-24"
                          data-testid={`textarea-notes-${plan._id}`}
                        />
                      </div>
                      <div className="flex gap-3">
                        <Button
                          onClick={() => logSessionMutation.mutate({ planId: plan._id, duration: sessionDuration, notes: sessionNotes })}
                          disabled={logSessionMutation.isPending}
                          data-testid={`button-submit-log-${plan._id}`}
                        >
                          {logSessionMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Submit Session
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setSelectedPlanForLogging(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Notes Section */}
                <Card className="p-6 bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-foreground flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Personal Notes
                    </h3>
                    <button
                      onClick={() => setExpandedNotePlanId(expandedNotePlanId === plan._id ? null : plan._id)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {expandedNotePlanId === plan._id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                  {expandedNotePlanId === plan._id && (
                    <div className="space-y-3">
                      <Textarea
                        value={getPlanNotes(plan._id)}
                        onChange={(e) => setExpandedNotePlanId(plan._id)}
                        placeholder="Add your notes here..."
                        className="min-h-24"
                        data-testid={`textarea-personal-notes-${plan._id}`}
                      />
                      <Button
                        size="sm"
                        onClick={() => notesMutation.mutate({ planId: plan._id, notes: getPlanNotes(plan._id) })}
                        disabled={notesMutation.isPending}
                      >
                        {notesMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Save Notes
                      </Button>
                    </div>
                  )}
                  {!expandedNotePlanId && getPlanNotes(plan._id) && (
                    <p className="text-sm text-foreground">{getPlanNotes(plan._id)}</p>
                  )}
                  {!expandedNotePlanId && !getPlanNotes(plan._id) && (
                    <p className="text-sm text-muted-foreground italic">No notes yet</p>
                  )}
                </Card>

                {/* History Section */}
                {getPlanHistory(plan._id).length > 0 && (
                  <Card className="p-6 bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800">
                    <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      Recent Sessions ({getPlanHistory(plan._id).length} total)
                    </h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {getPlanHistory(plan._id).slice(0, 5).map((session: WorkoutSession) => (
                        <div key={session._id} className="flex items-center justify-between p-3 bg-background rounded-md">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">{session.workoutName}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(session.completedAt).toLocaleDateString()} - {session.duration} min
                            </p>
                          </div>
                          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                <div className="border-t pt-8" />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
