import { ClientHeader } from "@/components/client-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Play, Search, Filter, Loader2, X, Bookmark, BookmarkCheck } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import { MobileNavigation } from "@/components/mobile-navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { VideoPlayerModal } from "@/components/video-player-modal";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Video {
  _id: string;
  title: string;
  description?: string;
  url: string;
  thumbnail?: string;
  hasVideoData?: boolean;
  hasThumbnailData?: boolean;
  category: string;
  duration?: number;
  intensity?: string;
  difficulty?: string;
  trainer?: string;
  equipment?: string[];
  isDraft: boolean;
}

export default function ClientVideoLibrary() {
  const [, setLocation] = useLocation();
  const [clientId, setClientId] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState<{ url: string; title: string; id: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [viewingBookmarks, setViewingBookmarks] = useState(false);

  useEffect(() => {
    console.log("ClientVideoLibrary rendered, viewingBookmarks:", viewingBookmarks);
  }, [viewingBookmarks]);

  useEffect(() => {
    const id = localStorage.getItem("clientId");
    if (!id) {
      setLocation("/client-access");
    } else {
      setClientId(id);
    }
  }, [setLocation]);

  const { data: videos = [], isLoading } = useQuery<Video[]>({
    queryKey: ['/api/videos'],
    enabled: !!clientId,
  });

  const { data: bookmarkedVideos = [], isLoading: bookmarksLoading } = useQuery<Video[]>({
    queryKey: ['/api/clients', clientId, 'bookmarks'],
    enabled: !!clientId,
  });

  const { data: bookmarks = [] } = useQuery<any[]>({
    queryKey: [`/api/clients/${clientId}/bookmarks`],
    enabled: !!clientId,
  });

  const bookmarkMutation = useMutation({
    mutationFn: async ({ videoId, isBookmarked }: { videoId: string; isBookmarked: boolean }) => {
      if (isBookmarked) {
        return apiRequest('DELETE', `/api/clients/${clientId}/bookmarks/${videoId}`);
      } else {
        return apiRequest('POST', `/api/clients/${clientId}/bookmarks/${videoId}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/bookmarks`] });
    },
  });

  const isVideoBookmarked = (videoId: string) => {
    const result = bookmarks.some(b => b.videoId === videoId);
    console.log("isVideoBookmarked called for", videoId, "result:", result, "bookmarks:", bookmarks);
    return result;
  };

  const handleToggleBookmark = (videoId: string) => {
    const isBookmarked = isVideoBookmarked(videoId);
    console.log("handleToggleBookmark called for", videoId, "isBookmarked:", isBookmarked);
    bookmarkMutation.mutate({ videoId, isBookmarked });
  };

  // Filter videos (exclude drafts)
  const displayVideos = viewingBookmarks ? bookmarkedVideos : videos;
  const filteredVideos = displayVideos
    .filter(video => !video.isDraft)
    .filter(video => {
      const matchesSearch = video.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        video.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === "all" || video.category === categoryFilter;
      const matchesDifficulty = difficultyFilter === "all" || video.difficulty === difficultyFilter;
      return matchesSearch && matchesCategory && matchesDifficulty;
    });


  return (
    <div className="w-full bg-background min-h-screen mb-20 md:mb-0">
      <ClientHeader currentPage="videos" />

      <main className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Header */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl sm:text-5xl font-black text-black dark:text-white">
                  {viewingBookmarks ? "Bookmarked Videos" : "Video Library"}
                </h1>
                <p className="text-muted-foreground mt-2">
                  {viewingBookmarks 
                    ? "Your saved workout videos" 
                    : "Browse and watch all available workout videos"}
                </p>
              </div>
              <Button
                onClick={() => setViewingBookmarks(!viewingBookmarks)}
                variant={viewingBookmarks ? "default" : "outline"}
                className="gap-2 whitespace-nowrap"
                data-testid="button-bookmarks-toggle"
              >
                <Bookmark className="h-4 w-4" />
                <span className="hidden sm:inline">Bookmarks</span>
              </Button>
            </div>

            {/* Search and Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search videos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-videos"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setSearchQuery("")}
                    data-testid="button-clear-search"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="sm:w-48" data-testid="select-category-filter">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="Strength">Strength</SelectItem>
                  <SelectItem value="Cardio">Cardio</SelectItem>
                  <SelectItem value="Yoga">Yoga</SelectItem>
                  <SelectItem value="HIIT">HIIT</SelectItem>
                  <SelectItem value="Flexibility">Flexibility</SelectItem>
                </SelectContent>
              </Select>
              <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
                <SelectTrigger className="sm:w-48" data-testid="select-difficulty-filter">
                  <SelectValue placeholder="Difficulty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Loading State */}
          {(isLoading || bookmarksLoading) && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Empty State */}
          {!(isLoading || bookmarksLoading) && filteredVideos.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {viewingBookmarks
                  ? "You haven't bookmarked any videos yet."
                  : searchQuery || categoryFilter !== "all" || difficultyFilter !== "all"
                  ? "No videos found matching your filters."
                  : "No videos available yet."}
              </p>
            </div>
          )}

          {/* Videos Grid */}
          {!(isLoading || bookmarksLoading) && filteredVideos.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredVideos.map((video) => {
                const isBookmarked = isVideoBookmarked(video._id);
                console.log("Rendering video card for", video._id, "isBookmarked:", isBookmarked);
                return (
                <Card
                  key={video._id}
                  className="hover-elevate overflow-hidden cursor-pointer transition-all group"
                  onClick={() => setPlayingVideo({ url: `/api/videos/${video._id}/stream`, title: video.title, id: video._id })}
                  data-testid={`video-card-${video._id}`}
                >
                  <div className="relative aspect-video bg-muted overflow-hidden">
                    {video.thumbnail || video.hasThumbnailData ? (
                      <img
                        src={video.hasThumbnailData ? `/api/videos/${video._id}/thumbnail` : video.thumbnail}
                        alt={video.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full bg-gradient-to-br from-primary/20 to-primary/5">
                        <Play className="h-12 w-12 text-primary/40" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-primary rounded-full p-3">
                          <Play className="h-6 w-6 text-primary-foreground fill-primary-foreground" />
                        </div>
                      </div>
                    </div>
                    <div className="absolute top-2 right-2 z-20">
                      <Button
                        size="icon"
                        className="h-10 w-10 rounded-full bg-black/60 hover:bg-black/80 text-white border-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleBookmark(video._id);
                        }}
                        data-testid={`button-bookmark-${video._id}`}
                      >
                        {isBookmarked ? (
                          <BookmarkCheck className="h-5 w-5 fill-current" />
                        ) : (
                          <Bookmark className="h-5 w-5" />
                        )}
                      </Button>
                    </div>
                    {video.duration && (
                      <div className="absolute bottom-2 right-2 bg-black/80 rounded-md px-2 py-1 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-white" />
                        <span className="text-xs font-semibold text-white">
                          {video.duration} min
                        </span>
                      </div>
                    )}
                    {video.difficulty && (
                      <div className="absolute top-2 left-2 bg-black/80 rounded-md px-2 py-1">
                        <span className="text-xs font-semibold text-white capitalize">
                          {video.difficulty}
                        </span>
                      </div>
                    )}
                  </div>
                  <CardContent className="pt-4 pb-3 space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      {video.category}
                    </div>
                    <h3 className="font-semibold line-clamp-2">
                      {video.title}
                    </h3>
                    {video.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {video.description}
                      </p>
                    )}
                    {video.trainer && (
                      <p className="text-xs text-muted-foreground">
                        Trainer: {video.trainer}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Video Player Modal with Resume Feature */}
      <VideoPlayerModal
        isOpen={!!playingVideo}
        onClose={() => setPlayingVideo(null)}
        videoUrl={playingVideo?.url || ""}
        videoTitle={playingVideo?.title || ""}
        videoId={playingVideo?.id || ""}
      />

      <MobileNavigation />
    </div>
  );
}
