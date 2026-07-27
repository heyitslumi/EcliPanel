"use client"

import { useTranslations } from "next-intl";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { getActivityActionLabel } from "@/lib/activity-action-labels";
import {
  orgGuessType,
  orgTypeIcons,
  orgTypeColors,
  orgTypeBadgeColors,
} from "@/components/activity/helpers";
import { UserPlus, Server, Receipt, Shield, Activity } from "lucide-react";

interface ActivityTabProps {
  orgId: string;
  activity: any[];
  activityLoading: boolean;
  activityPage: number;
  activityHasMore: boolean;
  onLoadActivity: (page: number) => void;
}

export function ActivityTab({
  orgId,
  activity,
  activityLoading,
  activityPage,
  activityHasMore,
  onLoadActivity,
}: ActivityTabProps) {
  const t = useTranslations("organisationsDetailPage");

  return (
    <ActivityFeed
      logs={activity}
      loading={activityLoading}
      getActionLabel={(action) =>
        getActivityActionLabel(action, {
          "org:create": t("activity.actions.orgCreate"),
          "org:add_user": t("activity.actions.orgAddUser"),
          "org:remove_member": t("activity.actions.orgRemoveMember"),
          "org:change_role": t("activity.actions.orgChangeRole"),
          "org:invite": t("activity.actions.orgInvite"),
          "org:resend_invite": t("activity.actions.orgResendInvite"),
          "org:revoke_invite": t("activity.actions.orgRevokeInvite"),
          "org:accept_invite": t("activity.actions.orgAcceptInvite"),
          "server:create": t("activity.actions.serverCreate"),
          "server:delete": t("activity.actions.serverDelete"),
          "server:update": t("activity.actions.serverUpdate"),
          "server:suspend": t("activity.actions.serverSuspend"),
          "server:unsuspend": t("activity.actions.serverUnsuspend"),
        })
      }
      guessTypeFn={orgGuessType}
      typeIconsMap={orgTypeIcons}
      typeColorsMap={orgTypeColors}
      typeBadgeColorsMap={orgTypeBadgeColors}
      page={activityPage}
      hasMore={activityHasMore}
      onPrevPage={() => onLoadActivity(Math.max(1, activityPage - 1))}
      onNextPage={() => onLoadActivity(activityPage + 1)}
      onRefresh={() => onLoadActivity(activityPage)}
      refreshing={activityLoading}
      translate={t}
      filterOptions={[
        { key: "member", label: t("filters.member"), icon: UserPlus },
        { key: "server", label: t("filters.server"), icon: Server },
        { key: "billing", label: t("filters.billing"), icon: Receipt },
        { key: "security", label: t("filters.security"), icon: Shield },
        { key: "support", label: t("filters.support"), icon: Activity },
      ]}
    />
  );
}