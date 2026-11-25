"""Canonical finish-to-start graph, including legacy single-edge records."""

from collections import defaultdict

from django.core.exceptions import ValidationError


def validate_dependency_graph(workspace_id, overrides):
    from .operating_models import OperatingTask, OperatingTaskPredecessor

    primary = dict(OperatingTask.objects.filter(workspace_id=workspace_id).values_list('pk', 'dependency_id'))
    graph = {pk: {dependency} if dependency else set() for pk, dependency in primary.items()}
    for task, predecessor in OperatingTaskPredecessor.objects.filter(task__workspace_id=workspace_id).values_list('task_id', 'predecessor_id'):
        graph[task].add(predecessor)
    for pk, dependencies in overrides.items():
        graph[pk] = set(dependencies)

    dependants = defaultdict(list)
    counts = {}
    for pk, dependencies in graph.items():
        for predecessor in dependencies:
            if predecessor not in graph:
                raise ValidationError({'dependency': 'Dependencies must share a workspace.'})
            dependants[predecessor].append(pk)
        counts[pk] = len(dependencies)

    available = [pk for pk, count in counts.items() if count == 0]
    for pk in available:
        for dependant in dependants[pk]:
            counts[dependant] -= 1
            if counts[dependant] == 0:
                available.append(dependant)
    if len(available) != len(graph):
        raise ValidationError({'dependency': 'Task dependencies cannot contain a cycle.'})
