import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ClientHeader } from "@/components/client-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Bookmark, BookmarkCheck, CheckCircle2, Clock, Dumbbell, BarChart3, FileText, AlertCircle, Loader2 } from "lucide-react";
import { useState } from "react";

interface WorkoutPlan {
  _id: string;
  name: string;
  description?: string;
  durationWeeks: number;
  exercises: any;
  category?: string;
  goal?: string;
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

  // Get client ID from localStorage
  const clientId = localStorage.getItem("clientId");

  // Fetch assigned workout plans
  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-plans`],
    enabled: !!clientId,
  });

  // Fetch bookmarked workout plans
  const { data: bookmarks = [], isLoading: bookmarksLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-bookmarks`],
    enabled: !!clientId,
  });

  // Fetch workout history
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-history`],
    enabled: !!clientId,
  });

  // Fetch workout notes
  const { data: notesMap = {}, isLoading: notesLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-notes`],
    enabled: !!clientId,
  });

  // Bookmark mutation
  const bookmarkMutation = useMutation({
    mutationFn: async ({ planId, isBookmarked }: { planId: string; isBookmarked: boolean }) => {
      if (isBookmarked) {
        return apiRequest('DELETE', `/api/clients/${clientId}/workout-bookmarks/${planId}`);
      } else {
        return apiRequest('POST', `/api/clients/${clientId}/workout-bookmarks/${planId}`);
      }
    },
    onMutate: async ({ planId, isBookmarked }) => {
      await queryClient.cancelQueries({ queryKey: [`/api/clients/${clientId}/workout-bookmarks`] });
      const previousBookmarks = queryClient.getQueryData([`/api/clients/${clientId}/workout-bookmarks`]);
      
      if (isBookmarked) {
        queryClient.setQueryData([`/api/clients/${clientId}/workout-bookmarks`], 
          (previousBookmarks || []).filter((b: any) => b.workoutPlanId !== planId)
        );
      } else {
        const plan = plans.find(p => p._id === planId);
        if (plan) {
          queryClient.setQueryData([`/api/clients/${clientId}/workout-bookmarks`], 
            [...(previousBookmarks || []), { workoutPlanId: planId, workoutPlan: plan }]
          );
        }
      }
      return { previousBookmarks };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/workout-bookmarks`] });
      toast({ description: "Workout bookmark updated" });
    },
    onError: () => {
      toast({ description: "Failed to update bookmark", variant: "destructive" });
    },
  });

  // Log workout mutation
  const logWorkoutMutation = useMutation({
    mutationFn: async ({ planId, duration, notes }: { planId: string; duration: number; notes: string }) => {
      const plan = plans.find(p => p._id === planId);
      return apiRequest('POST', `/api/clients/${clientId}/workout-history`, {
        workoutPlanId: planId,
        workoutName: plan?.name || "Workout",
        duration,
        notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/workout-history`] });
      setSelectedPlanForLogging(null);
      setSessionNotes("");
      setSessionDuration("30");
      toast({ description: "Workout session logged successfully!" });
    },
    onError: () => {
      toast({ description: "Failed to log workout", variant: "destructive" });
    },
  });

  // Save notes mutation
  const saveNotesMutation = useMutation({
    mutationFn: async ({ planId, notes }: { planId: string; notes: string }) => {
      return apiRequest('POST', `/api/clients/${clientId}/workout-notes/${planId}`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/workout-notes`] });
      toast({ description: "Notes saved successfully!" });
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
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-500">Unable to load workout plans</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <ClientHeader currentPage="workout-history" />
      
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Workout Plans</h1>
          <p className="text-muted-foreground">
            View your trainer-assigned workout plans, log sessions, bookmark favorites, and track your progress.
          </p>
        </div>

        <Tabs defaultValue="plans" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="plans">Plans</TabsTrigger>
            <TabsTrigger value="bookmarks">Bookmarks</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          {/* Plans Tab */}
          <TabsContent value="plans" className="space-y-4 mt-6">
            {plansLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : plans.length === 0 ? (
              <Card className="p-8 text-center">
                <Dumbbell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">No workout plans assigned yet</p>
                <p className="text-sm text-muted-foreground">Your trainer will assign custom workout plans here.</p>
              </Card>
            ) : (
              <div className="grid gap-4">
                {plans.map((plan: WorkoutPlan) => (
                  <Card key={plan._id} className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold mb-2">{plan.name}</h3>
                        {plan.description && <p className="text-sm text-muted-foreground mb-3">{plan.description}</p>}
                        <div className="flex gap-4 text-sm">
                          {plan.durationWeeks && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              {plan.durationWeeks} weeks
                            </span>
                          )}
                          {plan.category && (
                            <span className="bg-secondary px-2 py-1 rounded text-xs font-medium">{plan.category}</span>
                          )}
                          {plan.goal && (
                            <span className="text-muted-foreground">{plan.goal}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => bookmarkMutation.mutate({ planId: plan._id, isBookmarked: isBookmarked(plan._id) })}
                          data-testid={`button-bookmark-workout-${plan._id}`}
                        >
                          {isBookmarked(plan._id) ? (
                            <BookmarkCheck className="h-5 w-5 fill-primary text-primary" />
                          ) : (
                            <Bookmark className="h-5 w-5" />
                          )}
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => setSelectedPlanForLogging(plan._id)}
                          disabled={selectedPlanForLogging === plan._id}
                          data-testid={`button-log-workout-${plan._id}`}
                        >
                          Log Session
                        </Button>
                      </div>
                    </div>

                    {/* Log workout form */}
                    {selectedPlanForLogging === plan._id && (
                      <div className="mt-4 pt-4 border-t space-y-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Duration (minutes)</label>
                          <input
                            type="number"
                            value={sessionDuration}
                            onChange={(e) => setSessionDuration(e.target.value)}
                            className="w-full px-3 py-2 border rounded-md text-sm"
                            data-testid="input-duration"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Session Notes</label>
                          <Textarea
                            value={sessionNotes}
                            onChange={(e) => setSessionNotes(e.target.value)}
                            placeholder="How did the workout go? Any challenges or improvements?"
                            className="min-h-20"
                            data-testid="textarea-notes"
                          />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedPlanForLogging(null)}
                            data-testid="button-cancel-log"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => logWorkoutMutation.mutate({
                              planId: plan._id,
                              duration: parseInt(sessionDuration),
                              notes: sessionNotes,
                            })}
                            disabled={logWorkoutMutation.isPending}
                            data-testid="button-save-workout"
                          >
                            {logWorkoutMutation.isPending ? "Saving..." : "Save Session"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Expand exercises */}
                    <div className="mt-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedPlanId(expandedPlanId === plan._id ? null : plan._id)}
                        data-testid={`button-expand-${plan._id}`}
                      >
                        {expandedPlanId === plan._id ? "Hide" : "View"} Exercises
                      </Button>
                      {expandedPlanId === plan._id && plan.exercises && (
                        <div className="mt-4 space-y-3 text-sm">
                          {Object.entries(plan.exercises).map(([day, exercises]: [string, any]) => (
                            <div key={day} className="bg-secondary/50 p-3 rounded">
                              <p className="font-semibold mb-2 capitalize">{day}</p>
                              {Array.isArray(exercises) ? (
                                <ul className="list-disc list-inside space-y-1">
                                  {exercises.map((ex: any, idx: number) => (
                                    <li key={idx}>
                                      {typeof ex === 'string' ? ex : ex.name || JSON.stringify(ex)}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-muted-foreground">No exercises configured</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Bookmarks Tab */}
          <TabsContent value="bookmarks" className="space-y-4 mt-6">
            {bookmarksLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : bookmarks.length === 0 ? (
              <Card className="p-8 text-center">
                <Bookmark className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No bookmarked workouts yet</p>
                <p className="text-sm text-muted-foreground">Bookmark your favorite plans for quick access.</p>
              </Card>
            ) : (
              <div className="grid gap-4">
                {bookmarks.map((bookmark: any) => {
                  const plan = bookmark.workoutPlan || plans.find(p => p._id === bookmark.workoutPlanId);
                  return plan ? (
                    <Card key={bookmark._id} className="p-4">
                      <h3 className="font-semibold mb-2">{plan.name}</h3>
                      <p className="text-sm text-muted-foreground mb-3">{plan.description}</p>
                      <Button
                        size="sm"
                        onClick={() => bookmarkMutation.mutate({ planId: plan._id, isBookmarked: true })}
                        variant="outline"
                        data-testid={`button-remove-bookmark-${plan._id}`}
                      >
                        Remove Bookmark
                      </Button>
                    </Card>
                  ) : null;
                })}
              </div>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4 mt-6">
            {historyLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : history.length === 0 ? (
              <Card className="p-8 text-center">
                <CheckCircle2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No workout sessions logged yet</p>
                <p className="text-sm text-muted-foreground">Start logging sessions from your workout plans.</p>
              </Card>
            ) : (
              <div className="space-y-4">
                {plans.map((plan: WorkoutPlan) => {
                  const planHistory = getPlanHistory(plan._id);
                  return planHistory.length > 0 ? (
                    <div key={plan._id}>
                      <h3 className="font-semibold mb-3">{plan.name}</h3>
                      <div className="space-y-2">
                        {planHistory.map((session: WorkoutSession) => (
                          <Card key={session._id} className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <p className="font-medium">{session.workoutName}</p>
                                <p className="text-sm text-muted-foreground">
                                  {new Date(session.completedAt).toLocaleDateString()} - {session.duration} minutes
                                </p>
                                {session.notes && <p className="text-sm mt-2">{session.notes}</p>}
                              </div>
                              <BarChart3 className="h-5 w-5 text-green-600" />
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })}
              </div>
            )}
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="space-y-4 mt-6">
            {notesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : plans.length === 0 ? (
              <Card className="p-8 text-center">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No workout plans to add notes to</p>
              </Card>
            ) : (
              <div className="space-y-6">
                {plans.map((plan: WorkoutPlan) => (
                  <Card key={plan._id} className="p-6">
                    <h3 className="font-semibold mb-4">{plan.name}</h3>
                    <Textarea
                      defaultValue={getPlanNotes(plan._id)}
                      placeholder="Add personal notes about this workout plan..."
                      className="min-h-24 mb-3"
                      data-testid={`textarea-plan-notes-${plan._id}`}
                      onChange={(e) => {
                        const notes = e.currentTarget.value;
                        setSessionNotes(notes);
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={() => saveNotesMutation.mutate({ planId: plan._id, notes: sessionNotes || getPlanNotes(plan._id) })}
                      disabled={saveNotesMutation.isPending}
                      data-testid={`button-save-notes-${plan._id}`}
                    >
                      {saveNotesMutation.isPending ? "Saving..." : "Save Notes"}
                    </Button>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
