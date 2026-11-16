package com.radiflow.player

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.core.content.ContextCompat

/**
 * Reads the device's Music folders (internal storage and SD cards) from the
 * system media store: fast for large libraries, and title/artist/album/duration
 * come from the system index instead of parsing every file.
 */
object MediaStoreLibrary {
    val permission: String = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
        Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE

    fun hasPermission(context: Context) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private val collection get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
        MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) else MediaStore.Audio.Media.EXTERNAL_CONTENT_URI

    /** Every music file under a top-level `Music` folder on any external volume. */
    fun query(context: Context): List<Track> {
        if (!hasPermission(context)) return emptyList()
        val projection = arrayOf(
            MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.ALBUM_ID, MediaStore.Audio.Media.DURATION,
        )
        // RELATIVE_PATH exists from Android 10; older releases only expose the absolute path.
        val selection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.RELATIVE_PATH} LIKE 'Music/%'"
        else "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.DATA} LIKE '%/Music/%'"
        val tracks = ArrayList<Track>()
        context.contentResolver.query(collection, projection, selection, null, "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE")?.use { cursor ->
            val id = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val title = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val artist = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val album = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val albumId = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
            val duration = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            val base = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
            while (cursor.moveToNext()) {
                val uri = ContentUris.withAppendedId(base, cursor.getLong(id))
                val artistName = cursor.getString(artist).orEmpty().takeUnless { it == MediaStore.UNKNOWN_STRING }.orEmpty()
                tracks += Track(
                    id = uri.toString(),
                    title = cursor.getString(title).orEmpty().ifEmpty { uri.lastPathSegment.orEmpty() },
                    artist = artistName,
                    // Untagged files get their folder name ("Music") as album; treat that as unknown.
                    album = cursor.getString(album)?.takeUnless { it.isBlank() || it == MediaStore.UNKNOWN_STRING || it.equals("Music", ignoreCase = true) },
                    cover = "content://media/external/audio/albumart/${cursor.getLong(albumId)}",
                    durationSec = cursor.getLong(duration).takeIf { it > 0 }?.let { it / 1000.0 },
                )
            }
        }
        return tracks
    }

    /** Calls [onChange] (debounced by the caller) when the media store's audio index changes. */
    fun observe(context: Context, onChange: () -> Unit): ContentObserver {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) = onChange()
        }
        context.contentResolver.registerContentObserver(collection, true, observer)
        return observer
    }
}
