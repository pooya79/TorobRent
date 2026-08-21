import { queryOptions } from "@tanstack/react-query";

import { api, rememberCsrfToken } from "@/lib/api/client";

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/auth/session/");
    if (error || !data) throw new Error("Could not load the session");
    rememberCsrfToken(data.csrf_token);
    return data;
  },
});

export const currentUserQuery = queryOptions({
  queryKey: ["current-user"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/users/me/");
    if (error || !data) throw new Error("Could not load the current user");
    return data;
  },
});
