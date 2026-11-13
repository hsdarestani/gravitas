import { apiInitializer } from "discourse/lib/api";
import Navigation from "../components/graviquest/navigation";
import ForumHeading from "../components/graviquest/forum-heading";
import CommunityPanels from "../components/graviquest/community-panels";
import RoomLabel from "../components/graviquest/room-label";
import ThemeToggle from "../components/graviquest/theme-toggle";

import { ThreadBreadcrumb, ThreadByline, ThreadRail } from "../components/graviquest/thread-details";

export default apiInitializer((api) => {
  api.renderInOutlet("before-header-panel", Navigation);
  api.headerIcons.add("gq-theme", ThemeToggle, { before: "hamburger" });
  api.renderInOutlet("discovery-navigation-bar-above", ForumHeading);
  api.renderInOutlet("after-topic-list", CommunityPanels);
  api.renderInOutlet("topic-list-before-link", RoomLabel);
  api.renderInOutlet("topic-above-post-stream", ThreadBreadcrumb);
  api.renderInOutlet("topic-title", ThreadByline);
  api.renderInOutlet("topic-navigation", ThreadRail);
});
