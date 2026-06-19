package com.cvcenergia.mpp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.io.File;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class MppToJson {
    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("Uso: MppToJson <carpeta-mpp> <salida-json>");
            System.exit(2);
        }
        Path inputDir = Path.of(args[0]);
        Path output = Path.of(args[1]);
        if (!Files.isDirectory(inputDir)) {
            throw new IllegalArgumentException("No existe la carpeta: " + inputDir);
        }
        List<Path> files;
        try (Stream<Path> s = Files.walk(inputDir)) {
            files = s.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".mpp"))
                    .sorted(Comparator.comparing(p -> p.getFileName().toString().toLowerCase(Locale.ROOT)))
                    .collect(Collectors.toList());
        }
        if (files.isEmpty()) {
            throw new IllegalStateException("No se encontraron archivos .mpp en " + inputDir);
        }

        List<Map<String,Object>> projects = new ArrayList<>();
        for (Path file : files) {
            projects.add(convertProject(file));
        }

        Map<String,Object> root = new LinkedHashMap<>();
        root.put("projects", projects);
        root.put("generated_on", OffsetDateTime.now().toString());
        root.put("timezone", "America/Lima");
        Map<String,Object> verification = new LinkedHashMap<>();
        verification.put("source", "GitHub Actions + MPXJ");
        verification.put("files", files.stream().map(p -> p.getFileName().toString()).collect(Collectors.toList()));
        root.put("verification", verification);

        Files.createDirectories(output.getParent());
        ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
        mapper.writeValue(output.toFile(), root);
        System.out.println("Generado " + output + " desde " + files.size() + " archivo(s) .mpp");
    }

    private static Map<String,Object> convertProject(Path file) throws Exception {
        Object reader = Class.forName("org.mpxj.reader.UniversalProjectReader").getDeclaredConstructor().newInstance();
        Object project = invoke(reader, "read", new Class<?>[]{File.class}, new Object[]{file.toFile()});
        if (project == null) {
            project = invoke(reader, "read", new Class<?>[]{String.class}, new Object[]{file.toString()});
        }
        if (project == null) {
            throw new IllegalStateException("MPXJ no pudo leer " + file);
        }

        String fileName = file.getFileName().toString();
        String id = projectIdFromFile(fileName);
        String shortName = shortNameFromId(id);
        Object props = tryInvoke(project, "getProjectProperties");
        String title = str(firstNonNull(tryInvoke(props, "getTitle"), tryInvoke(props, "getName"), shortName));
        String author = str(tryInvoke(props, "getAuthor"));
        String lastSavedBy = str(tryInvoke(props, "getLastAuthor"));
        String creationDate = iso(tryInvoke(props, "getCreationDate"));
        String lastSaved = iso(firstNonNull(tryInvoke(props, "getLastSaved"), tryInvoke(props, "getLastSaveDate")));

        List<?> rawTasks = asList(tryInvoke(project, "getTasks"));
        if (rawTasks.isEmpty()) {
            rawTasks = asList(tryInvoke(project, "getAllTasks"));
        }

        List<TaskPack> packs = new ArrayList<>();
        Map<String, TaskPack> byUniqueId = new HashMap<>();
        int index = 0;
        for (Object task : rawTasks) {
            if (task == null) continue;
            String name = str(tryInvoke(task, "getName"));
            Object idObj = firstNonNull(tryInvoke(task, "getID"), tryInvoke(task, "getId"));
            Object uidObj = firstNonNull(tryInvoke(task, "getUniqueID"), tryInvoke(task, "getUniqueId"));
            if ((name == null || name.isBlank()) && idObj == null && uidObj == null) continue;

            Map<String,Object> t = new LinkedHashMap<>();
            int taskId = intValue(idObj, index);
            int uniqueId = intValue(uidObj, taskId);
            String outline = str(firstNonNull(tryInvoke(task, "getOutlineNumber"), tryInvoke(task, "getOutline"), taskId));
            int level = intValue(firstNonNull(tryInvoke(task, "getOutlineLevel"), outlineLevel(outline)), outlineLevel(outline));
            boolean summary = bool(firstNonNull(tryInvoke(task, "getSummary"), tryInvoke(task, "getSummaryTask"), false));
            boolean milestone = bool(firstNonNull(tryInvoke(task, "getMilestone"), tryInvoke(task, "getMilestoneTask"), false));

            t.put("project_id", id);
            t.put("project_name", title);
            t.put("project_short", shortName);
            t.put("task_id", taskId);
            t.put("unique_id", uniqueId);
            t.put("uid", id + "-" + uniqueId);
            t.put("outline", outline);
            t.put("outline_level", level);
            t.put("name", name == null || name.isBlank() ? "Sin nombre" : name);
            t.put("is_summary", summary);
            t.put("is_milestone", milestone);
            t.put("start", iso(tryInvoke(task, "getStart")));
            t.put("finish", iso(tryInvoke(task, "getFinish")));
            Object duration = tryInvoke(task, "getDuration");
            t.put("duration_text", str(duration));
            t.put("duration_days", durationDays(duration));
            t.put("percent_complete", doubleValue(firstNonNull(tryInvoke(task, "getPercentageComplete"), tryInvoke(task, "getPercentComplete")), 0.0));
            t.put("resource_names", str(firstNonNull(tryInvoke(task, "getResourceNames"), resourcesFromAssignments(task))));
            t.put("responsible", str(firstNonNull(tryInvoke(task, "getResourceNames"), resourcesFromAssignments(task))));
            t.put("critical", bool(firstNonNull(tryInvoke(task, "getCritical"), false)));
            t.put("total_slack", str(tryInvoke(task, "getTotalSlack")));
            t.put("deadline", iso(tryInvoke(task, "getDeadline")));
            t.put("notes", str(tryInvoke(task, "getNotes")));
            t.put("predecessors", new ArrayList<Map<String,Object>>());
            t.put("predecessor_text", "");

            TaskPack pack = new TaskPack(task, t, taskId, uniqueId, outline);
            packs.add(pack);
            byUniqueId.put(String.valueOf(uniqueId), pack);
            index++;
        }

        for (TaskPack pack : packs) {
            List<Map<String,Object>> preds = new ArrayList<>();
            List<?> relations = asList(tryInvoke(pack.rawTask, "getPredecessors"));
            for (Object rel : relations) {
                Object predUidObj = firstNonNull(tryInvoke(rel, "getTaskUniqueID"), tryInvoke(rel, "getTaskUniqueId"), tryInvoke(rel, "getTargetTaskUniqueID"), tryInvoke(rel, "getSourceTaskUniqueID"));
                TaskPack pred = byUniqueId.get(String.valueOf(intValue(predUidObj, -1)));
                if (pred == null) continue;
                Map<String,Object> predInfo = new LinkedHashMap<>();
                predInfo.put("task_id", pred.taskId);
                predInfo.put("unique_id", pred.uniqueId);
                predInfo.put("outline", pred.outline);
                predInfo.put("name", pred.name());
                Map<String,Object> relMap = new LinkedHashMap<>();
                relMap.put("type", str(firstNonNull(tryInvoke(rel, "getType"), "FS")));
                relMap.put("lag", str(firstNonNull(tryInvoke(rel, "getLag"), tryInvoke(rel, "getDuration"), "")));
                relMap.put("predecessor", predInfo);
                preds.add(relMap);
            }
            pack.data.put("predecessors", preds);
            pack.data.put("predecessor_text", preds.stream().map(p -> {
                Map<?,?> pred = (Map<?,?>) p.get("predecessor");
                return pred.get("outline") + " " + p.get("type") + " " + pred.get("name");
            }).collect(Collectors.joining("; ")));
        }

        List<Map<String,Object>> tasks = packs.stream().map(p -> p.data).collect(Collectors.toList());
        String start = minIso(tasks, "start");
        String finish = maxIso(tasks, "finish");
        if (title == null || title.isBlank()) {
            title = tasks.isEmpty() ? shortName : str(tasks.get(0).get("name"));
        }
        Map<String,Object> verification = new LinkedHashMap<>();
        verification.put("activities_total", tasks.stream().filter(t -> !bool(t.get("is_summary"))).count());
        verification.put("summary_total", tasks.stream().filter(t -> bool(t.get("is_summary"))).count());
        verification.put("source", "MPXJ");

        Map<String,Object> out = new LinkedHashMap<>();
        out.put("id", id);
        out.put("name", title);
        out.put("short", shortName);
        out.put("description", "Cronograma actualizado desde archivo Microsoft Project (.mpp).");
        out.put("source_file", fileName);
        out.put("title", title);
        out.put("author", author == null ? "" : author);
        out.put("last_saved_by", lastSavedBy == null ? "" : lastSavedBy);
        out.put("start", start);
        out.put("finish", finish);
        out.put("creation_date", creationDate);
        out.put("last_saved", lastSaved);
        out.put("verification", verification);
        out.put("tasks", tasks);
        return out;
    }

    private static String projectIdFromFile(String fileName) {
        String n = fileName.toLowerCase(Locale.ROOT);
        if (n.contains("conex") || n.contains("vdch")) return "conexion-vdch";
        if (n.contains("alim") || n.contains("sullana")) return "alimentador-sullana";
        return n.replaceAll("\\.mpp$", "").replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
    }
    private static String shortNameFromId(String id) {
        if ("conexion-vdch".equals(id)) return "Conexión VDCH";
        if ("alimentador-sullana".equals(id)) return "Alimentador Sullana";
        return id;
    }

    private static Object tryInvoke(Object target, String method) {
        if (target == null) return null;
        try {
            Method m = target.getClass().getMethod(method);
            m.setAccessible(true);
            return m.invoke(target);
        } catch (Exception ignored) {
            return null;
        }
    }
    private static Object invoke(Object target, String method, Class<?>[] types, Object[] args) {
        if (target == null) return null;
        try {
            Method m = target.getClass().getMethod(method, types);
            m.setAccessible(true);
            return m.invoke(target, args);
        } catch (Exception ignored) {
            return null;
        }
    }
    private static List<?> asList(Object value) {
        if (value instanceof List<?>) return (List<?>) value;
        if (value instanceof Iterable<?>) {
            List<Object> list = new ArrayList<>();
            for (Object o : (Iterable<?>) value) list.add(o);
            return list;
        }
        return List.of();
    }
    private static Object firstNonNull(Object... values) {
        for (Object v : values) if (v != null) return v;
        return null;
    }
    private static String str(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v);
        if ("null".equalsIgnoreCase(s)) return null;
        return s;
    }
    private static String iso(Object v) {
        String s = str(v);
        if (s == null || s.isBlank()) return null;
        s = s.replace(" ", "T");
        if (s.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$")) s += ":00";
        if (s.matches("\\d{4}-\\d{2}-\\d{2}$")) s += "T00:00:00";
        return s;
    }
    private static int intValue(Object v, int fallback) {
        if (v == null) return fallback;
        if (v instanceof Number) return ((Number)v).intValue();
        try { return Integer.parseInt(String.valueOf(v).replaceAll("[^0-9-]", "")); } catch (Exception e) { return fallback; }
    }
    private static double doubleValue(Object v, double fallback) {
        if (v == null) return fallback;
        if (v instanceof Number) return ((Number)v).doubleValue();
        try { return Double.parseDouble(String.valueOf(v).replace(",", ".").replaceAll("[^0-9.-]", "")); } catch (Exception e) { return fallback; }
    }
    private static boolean bool(Object v) {
        if (v == null) return false;
        if (v instanceof Boolean) return (Boolean) v;
        return "true".equalsIgnoreCase(String.valueOf(v)) || "yes".equalsIgnoreCase(String.valueOf(v));
    }
    private static int outlineLevel(String outline) {
        if (outline == null || outline.isBlank()) return 0;
        return Math.max(0, outline.split("\\.").length);
    }
    private static double durationDays(Object duration) {
        if (duration == null) return 0.0;
        Object dur = firstNonNull(tryInvoke(duration, "getDuration"), tryInvoke(duration, "getValue"));
        double value = doubleValue(dur, Double.NaN);
        if (!Double.isNaN(value)) return value;
        String s = String.valueOf(duration).toLowerCase(Locale.ROOT);
        return doubleValue(s, 0.0);
    }
    private static String resourcesFromAssignments(Object task) {
        List<?> assignments = asList(tryInvoke(task, "getResourceAssignments"));
        List<String> names = new ArrayList<>();
        for (Object a : assignments) {
            Object res = tryInvoke(a, "getResource");
            String name = str(tryInvoke(res, "getName"));
            if (name != null && !name.isBlank()) names.add(name);
        }
        return names.isEmpty() ? null : String.join(", ", names);
    }
    private static String minIso(List<Map<String,Object>> tasks, String key) {
        return tasks.stream().map(t -> str(t.get(key))).filter(Objects::nonNull).min(String::compareTo).orElse(null);
    }
    private static String maxIso(List<Map<String,Object>> tasks, String key) {
        return tasks.stream().map(t -> str(t.get(key))).filter(Objects::nonNull).max(String::compareTo).orElse(null);
    }

    private static class TaskPack {
        final Object rawTask;
        final Map<String,Object> data;
        final int taskId;
        final int uniqueId;
        final String outline;
        TaskPack(Object rawTask, Map<String,Object> data, int taskId, int uniqueId, String outline) {
            this.rawTask = rawTask;
            this.data = data;
            this.taskId = taskId;
            this.uniqueId = uniqueId;
            this.outline = outline;
        }
        String name() { return str(data.get("name")); }
    }
}
