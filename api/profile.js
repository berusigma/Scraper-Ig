export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url, highlight_id, reel_url } = req.query;

    // ==========================================
    // HEADER + COOKIE (BUAT STORY & HIGHLIGHT)
    // ==========================================
    const SESSION_ID = "65092514569:tofeB3s3mKckSB:10:AYjrax5Hn5rGBL4ziAq5qoJrdofjeOctzBkqto5lYw";
    const DS_USER_ID = "65092514569";
    const CSRF_TOKEN = "t-YhlTgmNH1_CDj2ta4iUc";

    const baseHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "X-IG-App-ID": "936619743392459",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    };

    const authHeaders = {
        ...baseHeaders,
        "X-CSRFToken": CSRF_TOKEN,
        "Cookie": `sessionid=${SESSION_ID}; ds_user_id=${DS_USER_ID}; csrftoken=${CSRF_TOKEN};`
    };

    try {
        // ==========================================
        // MODE 1: DOWNLOAD REELS DARI URL REELS
        // ==========================================
        if (reel_url) {
            const reelId = extractReelId(reel_url);
            if (!reelId) throw new Error("URL Reels tidak valid");

            const reelData = await fetchReelMedia(reelId, authHeaders);
            return res.status(200).json({
                success: true,
                type: "reel_download",
                reel: reelData
            });
        }

        // ==========================================
        // MODE 2: LIHAT ISI HIGHLIGHT TERTENTU
        // ==========================================
        if (highlight_id) {
            const hMediaUrl = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:${highlight_id}`;
            const hRes = await fetch(hMediaUrl, { headers: authHeaders });
            const hData = await hRes.json();
            const items = hData.reels_media[0]?.items || [];

            return res.status(200).json({
                success: true,
                type: "highlight_items",
                items: items.map(i => ({
                    id: i.id,
                    type: i.media_type === 1 ? "image" : "video",
                    url: i.media_type === 1 ? i.image_versions2.candidates[0].url : i.video_versions[0].url
                }))
            });
        }

        // ==========================================
        // MODE 3: SCRAPE PROFIL LENGKAP
        // ==========================================
        if (!url) return res.status(400).json({ success: false, message: "Link mana bro?" });

        // Bersihin username
        let username = "";
        if (url.includes("instagram.com")) {
            const parsedUrl = new URL(url);
            username = parsedUrl.pathname.replace(/\//g, '').trim();
        } else {
            username = url.replace('@', '').trim();
        }
        if (!username) throw new Error("Username tidak ditemukan dari link.");

        // ----- 3a. Profil + Postingan (pakai logika kode terakhir yang WORK) -----
        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const profileResponse = await fetch(profileUrl, { headers: baseHeaders });
        if (!profileResponse.ok) throw new Error(`IG menolak akses (Status: ${profileResponse.status})`);

        const data = await profileResponse.json();
        if (!data?.data?.user) throw new Error("Akun tidak ditemukan atau di-private sepenuhnya");

        const user = data.data.user;
        const userId = user.id;

        // Postingan (LOGIKA DARI KODE LO YANG UDAH WORK)
        const timelineEdges = user.edge_owner_to_timeline_media.edges || [];
        const posts = timelineEdges.map(edge => {
            const node = edge.node;
            let children = [];
            if (node.__typename === 'GraphSidecar' && node.edge_sidecar_to_children) {
                children = node.edge_sidecar_to_children.edges.map(child => {
                    const cNode = child.node;
                    return {
                        id: cNode.id,
                        type: cNode.__typename,
                        url: cNode.is_video ? cNode.video_url : cNode.display_url
                    };
                });
            }
            return {
                id: node.id,
                shortcode: node.shortcode,
                type: node.__typename,
                thumbnail: node.display_url,
                video_url: node.video_url || null,
                carousel_items: children
            };
        });

        // ----- 3b. Story & Highlights (pakai COOKIE biar WORK) -----
        const [stories, highlights] = await Promise.all([
            fetchStoriesWithCookie(userId, authHeaders),
            fetchHighlightsWithCookie(userId, authHeaders)
        ]);

        res.status(200).json({
            success: true,
            extracted_username: username,
            profile: {
                id: user.id,
                full_name: user.full_name,
                bio: user.biography,
                profile_pic_hd: user.profile_pic_url_hd,
                followers: user.edge_followed_by.count,
                following: user.edge_follow.count,
                total_posts: user.edge_owner_to_timeline_media.count,
                is_private: user.is_private
            },
            data: {
                posts,
                stories,
                highlights
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Gagal menyedot data",
            error: error.message
        });
    }
}

// ==========================================
// FUNGSI BANTU: EKSTRAK REEL ID DARI URL
// ==========================================
function extractReelId(reelUrl) {
    try {
        // Pola: /reel/{shortcode}/ atau /reels/{shortcode}/
        const patterns = [
            /\/reel\/([a-zA-Z0-9_-]+)/,
            /\/reels\/([a-zA-Z0-9_-]+)/,
            /\/p\/([a-zA-Z0-9_-]+)/ // kadang reel pake /p/ juga
        ];
        
        for (const pattern of patterns) {
            const match = reelUrl.match(pattern);
            if (match) return match[1];
        }
        return null;
    } catch {
        return null;
    }
}

// ==========================================
// FUNGSI BANTU: AMBIL MEDIA REEL MENTAH
// ==========================================
async function fetchReelMedia(reelId, headers) {
    try {
        // Ambil data reel via GraphQL (no login needed, tapi pake cookie biar aman)
        const queryHash = 'b3055c01b4b222b8a47dc12b090e4e64';
        const variables = JSON.stringify({
            shortcode: reelId,
            child_comment_count: 3,
            fetch_comment_count: 40,
            parent_comment_count: 24,
            has_threaded_comments: true
        });
        
        const graphqlUrl = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(variables)}`;
        const resp = await fetch(graphqlUrl, { headers });
        const json = await resp.json();
        
        const media = json.data?.shortcode_media;
        if (!media) throw new Error("Reel tidak ditemukan");

        // Ambil URL video mentah (tanpa watermark)
        const videoUrl = media.video_url || 
                        media.video_versions?.[0]?.url || 
                        null;

        // Ambil thumbnail
        const thumbnail = media.display_url || 
                         media.image_versions2?.candidates?.[0]?.url || 
                         null;

        return {
            id: media.id,
            shortcode: media.shortcode,
            caption: media.edge_media_to_caption?.edges?.[0]?.node?.text || "",
            video_url: videoUrl,
            thumbnail: thumbnail,
            duration: media.video_duration || 0,
            dimensions: {
                width: media.dimensions?.width || 0,
                height: media.dimensions?.height || 0
            },
            like_count: media.edge_media_preview_like?.count || 0,
            comment_count: media.edge_media_to_comment?.count || 0,
            view_count: media.video_view_count || 0
        };
    } catch (error) {
        throw new Error(`Gagal mengambil reel: ${error.message}`);
    }
}

// ==========================================
// FUNGSI BANTU: STORY (PAKAI COOKIE)
// ==========================================
async function fetchStoriesWithCookie(userId, headers) {
    try {
        const url = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`;
        const resp = await fetch(url, { headers });
        if (!resp.ok) return [];

        const json = await resp.json();
        const reelsMedia = json.reels_media?.[0];
        if (!reelsMedia) return [];

        const items = reelsMedia.items || [];
        return items.map(item => ({
            id: item.id,
            type: item.media_type === 1 ? 'image' : 'video',
            url: item.media_type === 1 
                ? (item.image_versions2?.candidates?.[0]?.url || '')
                : (item.video_versions?.[0]?.url || ''),
            taken_at: item.taken_at_timestamp,
            expiring_at: item.expiring_at_timestamp
        }));
    } catch {
        return [];
    }
}

// ==========================================
// FUNGSI BANTU: HIGHLIGHTS (PAKAI COOKIE)
// ==========================================
async function fetchHighlightsWithCookie(userId, headers) {
    try {
        // Ambil daftar highlight
        const trayUrl = `https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`;
        const trayResp = await fetch(trayUrl, { headers });
        if (!trayResp.ok) return [];

        const trayData = await trayResp.json();
        const trayItems = trayData.tray || [];

        // Ambil detail tiap highlight (max 10)
        const highlights = await Promise.all(
            trayItems.slice(0, 10).map(async (item) => {
                try {
                    const detailUrl = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:${item.id}`;
                    const detailResp = await fetch(detailUrl, { headers });
                    const detailData = detailResp.ok ? await detailResp.json() : null;
                    const mediaItems = detailData?.reels_media?.[0]?.items || [];

                    return {
                        id: item.id,
                        title: item.title,
                        cover: item.cover_media?.cropped_image_version?.url || null,
                        items: mediaItems.map(m => ({
                            id: m.id,
                            type: m.is_video ? 'video' : 'image',
                            url: m.is_video
                                ? (m.video_versions?.[0]?.url || '')
                                : (m.image_versions2?.candidates?.[0]?.url || ''),
                            taken_at: m.taken_at_timestamp
                        }))
                    };
                } catch {
                    return {
                        id: item.id,
                        title: item.title,
                        cover: item.cover_media?.cropped_image_version?.url || null,
                        items: []
                    };
                }
            })
        );

        return highlights;
    } catch {
        return [];
    }
}
