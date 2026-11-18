import { apiInitializer } from "discourse/lib/api";
import I18n from "discourse-i18n";
import Navigation from "../components/graviquest/navigation";
import ForumHome from "../components/graviquest/forum-home";
import ThemeToggle from "../components/graviquest/theme-toggle";
import Footer from "../components/graviquest/footer";

import { ThreadBreadcrumb } from "../components/graviquest/thread-details";

// Discourse calls a discussion a "topic" and a room a "category". On
// GraviQuest a Topic is a published dossier ("Topic 01 · AI in Research" is a
// room's name), so a "New Topic" button beside the "Propose a Topic" room
// read as an offer to start a dossier. The forum's own copy already says
// thread and room; these are the stock strings a member meets most. Only
// strings that exist are replaced, so a renamed key in a later Discourse
// falls back to its stock wording instead of breaking.
const WORDS = {
  "topic.create": "New thread",
  "topic.create_long": "Start a new thread",
  "topic.title": "Thread",
  "composer.create_topic": "Post thread",
  "composer.reply_placeholder_choose_category": "Choose a room before typing here.",
  "category.choose": "Room…",
  "suggested_topics.title": "More threads",
  "topic.read_more_in_category": "Want to read more? Browse other threads in %{categoryLink} or <a href='%{latestLink}'>see the latest threads</a>.",
  "topic.read_more": "Want to read more? <a href='%{categoryLink}'>Browse the rooms</a> or <a href='%{latestLink}'>see the latest threads</a>.",
  "sidebar.sections.categories.header_link_text": "Rooms",
  "sidebar.all_categories": "All rooms",
  // A profile's figures, in the forum's words. Discourse's post_count counts
  // replies only (the opening post is the topic_count), so "replies" is exact.
  "user.summary.topic_count": { one: "thread started", other: "threads started" },
  "user.summary.post_count": { one: "reply", other: "replies" },
  "user.summary.likes_received": { one: "like received", other: "likes received" },
  "user.summary.top_topics": "Top threads",
};

// A string replaces a string; a plural ({one, other}) replaces a plural, form
// by form. Anything else leaves Discourse's own wording in place.
function useHouseWords() {
  const strings = I18n.translations?.[I18n.locale]?.js;
  for (const [path, text] of Object.entries(WORDS)) {
    const keys = path.split(".");
    const last = keys.pop();
    const parent = keys.reduce((node, key) => node?.[key], strings);
    const current = parent?.[last];
    if (typeof text === "string" && typeof current === "string") {
      parent[last] = text;
    } else if (typeof text === "object" && current && typeof current === "object") {
      for (const form of Object.keys(text)) {
        if (typeof current[form] === "string") current[form] = text[form];
      }
    }
  }
}

export default apiInitializer((api) => {
  useHouseWords();
  api.renderInOutlet("before-header-panel", Navigation);
  api.headerIcons.add("gq-theme", ThemeToggle, { before: "hamburger" });
  api.renderInOutlet("discovery-navigation-bar-above", ForumHome);
  api.renderInOutlet("topic-above-post-stream", ThreadBreadcrumb);
  api.renderInOutlet("below-footer", Footer);
  api.registerValueTransformer("topic-reply-count", ({ value }) =>
    Number.isInteger(value) ? Math.max(0, value) : 0
  );

  // The logo is the GraviQuest logo, so it goes where that logo goes on every
  // other page: graviquest.com. Discourse's default sent it to the forum's own
  // latest list, which the "Forum" heading and the menu already reach. The
  // same href serves the small logo shown while scrolling a thread. Guarded
  // so a Discourse without the callback keeps its stock link (the forum's
  // home) instead of failing the whole initializer.
  if (typeof api.registerHomeLogoHrefCallback === "function") {
    api.registerHomeLogoHrefCallback(() => "https://graviquest.com/");
  }

  // Each room's "About the … category" thread is its description, created by
  // Discourse with the room. In the lists they were ten identical rows. The
  // class lets common.scss drop them from every topic list; the thread itself
  // still opens from the room.
  api.registerValueTransformer("topic-list-item-class", ({ value, context }) => {
    // Readers' category data has no topic_id, only the description thread's
    // topic_url ("/t/about-the-…-category/9").
    const topic = context?.topic;
    const url = topic?.category?.topic_url;
    if (topic?.id && url && url.split("/").pop() === String(topic.id)) {
      value.push("gq-room-about");
    }
    // On a phone a row's reply count is a bare figure with no caption; a lone
    // "0" beside every new thread read as a score. common.scss hides it there
    // when there is nothing to count.
    if (topic && !(topic.replyCount > 0)) {
      value.push("gq-no-replies");
    }
    return value;
  });

  // Below 905px the header hides the site's sections and Workspace, and the
  // menu never offered them, so a phone had no way back to graviquest.com
  // except the logo. They are a menu section of their own; on a wide screen
  // CSS hides it, since the header already shows them.
  const siteLinks = [
    ["topics", "Topics", "https://graviquest.com/topics.html"],
    ["lab", "Lab", "https://graviquest.com/lab.html"],
    ["learn", "Learn", "https://graviquest.com/learn.html"],
    ["community", "Community", "https://graviquest.com/community"],
    // Workspace left the public site on 2026-11-17 (nothing links to it while
    // it is rebuilt), so it left this menu too.
  ];
  api.addSidebarSection((BaseCustomSidebarSection, BaseCustomSidebarSectionLink) => {
    const links = siteLinks.map(
      ([name, text, href]) =>
        new (class extends BaseCustomSidebarSectionLink {
          name = `gq-${name}`;
          href = href;
          title = text;
          text = text;
        })()
    );
    return class extends BaseCustomSidebarSection {
      name = "graviquest";
      title = "GraviQuest";
      text = "GraviQuest";
      links = links;
    };
  });
});
