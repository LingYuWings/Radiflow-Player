package com.radiflow.player

import androidx.compose.runtime.Immutable
import org.json.JSONObject

@Immutable
data class LyricWord(val text: String, val start: Double, val duration: Double)

@Immutable
data class LyricLine(
    val start: Double,
    val end: Double,
    val text: String,
    val translation: String? = null,
    val words: List<LyricWord>? = null,
)

/** Kotlin port of src/utils/lyricsParser.ts (parseLRC / parseYRC / mergeLyrics). */
object LyricsParser {
    private val timeTag = Regex("""\[(\d+):(\d+(?:\.\d+)?)]""")
    private val yrcLine = Regex("""^\[(\d+),(\d+)](.*)$""")
    private val yrcWord = Regex("""\((\d+),(\d+),(\d+)\)([^()]+)""")

    private class Mutable(var start: Double, var text: String, var translation: String?, var end: Double? = null,
                          var words: List<LyricWord>? = null)

    fun parseLrc(lrc: String): List<LyricLine> {
        val temp = mutableListOf<Mutable>()
        for (line in lrc.split('\n')) {
            val times = timeTag.findAll(line).map { it.groupValues[1].toInt() * 60 + it.groupValues[2].toDouble() }.toList()
            if (times.isEmpty()) continue
            var content = timeTag.replace(line, "").trim()
            var translation: String? = null
            for (separator in listOf(" / ", " // ", " | ")) {
                if (content.contains(separator)) {
                    val parts = content.split(separator)
                    content = parts[0].trim()
                    translation = parts.getOrNull(1)?.trim()?.ifEmpty { null }
                    break
                }
            }
            times.forEach { temp += Mutable(it, content.ifEmpty { " " }, translation) }
        }
        temp.sortBy { it.start }
        val merged = mutableListOf<Mutable>()
        for (line in temp) {
            val text = line.text.trim()
            if (text == "//") continue
            val existing = merged.firstOrNull { kotlin.math.abs(it.start - line.start) < 0.05 }
            if (existing != null) {
                if (existing.text == text) continue
                if (existing.translation == null && text.isNotEmpty()) existing.translation = text
                else if (existing.translation != null && text.isNotEmpty() && existing.translation != text) {
                    existing.translation += " $text"
                }
            } else merged += Mutable(line.start, text.ifEmpty { " " }, line.translation)
        }
        return merged.mapIndexed { index, line ->
            LyricLine(line.start, merged.getOrNull(index + 1)?.start ?: (line.start + 10), line.text, line.translation)
        }
    }

    fun parseYrc(yrc: String): List<LyricLine> {
        val result = mutableListOf<Mutable>()
        for (raw in yrc.split('\n')) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            if (line.startsWith("{") && line.endsWith("}")) {
                runCatching {
                    val metadata = JSONObject(line)
                    val start = metadata.optDouble("t") / 1000
                    val parts = metadata.optJSONArray("c")
                    val text = buildString {
                        if (parts != null) for (i in 0 until parts.length()) append(parts.optJSONObject(i)?.optString("tx").orEmpty())
                    }.trim()
                    if (start.isFinite() && text.isNotEmpty()) result += Mutable(start, text, null)
                }
                continue
            }
            val match = yrcLine.matchEntire(line) ?: continue
            val start = match.groupValues[1].toDouble() / 1000
            val duration = match.groupValues[2].toDouble() / 1000
            val content = match.groupValues[3]
            val words = yrcWord.findAll(content).mapNotNull {
                val text = it.groupValues[4]
                if (text.isEmpty()) null else LyricWord(text, it.groupValues[1].toDouble() / 1000, it.groupValues[2].toDouble() / 1000)
            }.toList()
            if (words.isNotEmpty()) {
                result += Mutable(start, words.joinToString("") { it.text }, null, start + duration, words)
            } else {
                val text = content.replace(Regex("""\(\d+,\d+,\d+\)"""), "").trim()
                if (text.isNotEmpty()) result += Mutable(start, text, null, start + duration)
            }
        }
        result.sortBy { it.start }
        return result.mapIndexed { index, line ->
            val next = result.getOrNull(index + 1)
            val end = line.end ?: if (next != null && next.start > line.start) next.start else line.start + 10
            LyricLine(line.start, end, line.text, line.translation, line.words)
        }
    }

    fun merge(primary: List<LyricLine>, translation: List<LyricLine>): List<LyricLine> {
        if (translation.isEmpty()) return primary
        return primary.map { line ->
            val match = translation.firstOrNull { kotlin.math.abs(it.start - line.start) < 0.1 && it.text != "//" && it.text.isNotBlank() }
            if (match != null && match.text != line.text) line.copy(translation = match.text) else line
        }
    }

    /** Index of the line playing at [seconds], or -1 before the first line. */
    fun activeIndex(lines: List<LyricLine>, seconds: Double): Int {
        var low = 0
        var high = lines.size - 1
        var found = -1
        while (low <= high) {
            val mid = (low + high) ushr 1
            if (lines[mid].start <= seconds) { found = mid; low = mid + 1 } else high = mid - 1
        }
        return found
    }
}
