import TopicExcerpt from "discourse/components/topic-list/topic-excerpt";
import DUserLink from "discourse/ui-kit/d-user-link";
import dAvatar from "discourse/ui-kit/helpers/d-avatar";

<template>
  {{#unless @outletArgs.expandPinned}}
    <TopicExcerpt @topic={{@outletArgs.topic}} />
  {{/unless}}
  {{#if @outletArgs.topic.lastPosterUser}}
    <div class="gq-discussion-meta">
      <DUserLink @user={{@outletArgs.topic.lastPosterUser}}>
        {{dAvatar @outletArgs.topic.lastPosterUser imageSize="small"}}
        {{@outletArgs.topic.lastPosterUser.username}}
      </DUserLink>
    </div>
  {{/if}}
</template>
