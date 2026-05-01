export default async function handler(req, res) {
    // Setting CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({
            success: false,
            message: "Link Instagram-nya mana bro?"
        });
    }

    // Header standar untuk semua panggilan API internal
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "X-IG-App-ID": "936619743392459",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin"
    };

    try {
        let username = "";

        // 1. Bersihkan link
        if (url.includes("instagram.com")) {
            const parsedUrl = new URL(url);
            username = parsedUrl.pathname.replace(/\//g, '').trim();
        } else {
            username = url.replace('@', '').trim();
        }

        if (!username) {
            throw new Error("Username tidak ditemukan dari link.");
        }

        // 2. Ambil data profil + timeline
        const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const profileResponse = await fetch(profileUrl, { headers });

        if (!profileResponse.ok) {
            throw new Error(`IG menolak akses (Status: ${profileResponse.status})`);
        }

        const data = await profileResponse.json();
        if (!data?.data?.user) {
            throw new Error("Akun tidak ditemukan atau di-private sepenuhnya");
        }

        const user = data.data.user;
        const userId = user.id;

        // 3. Mapping postingan (grid, reels, carousel)
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

        // 4. Ambil Story & Highlights secara paralel
        const [stories, highlights] = await Promise.all([
            fetchStories(userId, headers),
            fetchHighlights(userId, headers)
        ]);

        // 5. Response akhir
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
                highlights,
                stories
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

// ------------------------------------------------------------------
// Fungsi bantu: Ambil Story user
// ------------------------------------------------------------------
async function fetchStories(userId, headers) {
    try {
        const url = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`;
        const resp = await fetch(url, { headers });
        if (!resp.ok) return [];

        const json = await resp.json();
        const items = json.reels_media?.[0]?.items || [];
        return items.map(item => ({
            id: item.id,
            type: item.is_video ? 'video' : 'image',
            url: item.is_video
                ? (item.video_versions?.[0]?.url || '')
                : (item.image_versions2?.candidates?.[0]?.url || ''),
            taken_at: item.taken_at_timestamp,
            expiring_at: item.expiring_at_timestamp
        }));
    } catch {
        return [];
    }
}

// ------------------------------------------------------------------
// Fungsi bantu: Ambil Highlights (tray + detail tiap highlight)
// ------------------------------------------------------------------
async function fetchHighlights(userId, headers) {
    try {
        // 1. Ambil tray highlights
        const trayUrl = `https://www.instagram.com/api/v1/highlights/${userId}/highlights_tray/`;
        const trayResp = await fetch(trayUrl, { headers });
        if (!trayResp.ok) return [];

        const trayData = await trayResp.json();
        const trayItems = trayData.tray || [];

        // 2. Ambil detail setiap highlight secara paralel (maks 10 item biar aman)
        const highlightsWithItems = await Promise.all(
            trayItems.slice(0, 10).map(async (item) => {
                try {
                    const detailUrl = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:${item.id}`;
                    const detailResp = await fetch(detailUrl, { headers });
                    const itemData = detailResp.ok ? await detailResp.json() : null;
                    const mediaItems = itemData?.reels_media?.[0]?.items || [];

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
                    // Jika gagal ambil detail satu highlight, tetap kembalikan info ringkas
                    return {
                        id: item.id,
                        title: item.title,
                        cover: item.cover_media?.cropped_image_version?.url || null,
                        items: []
                    };
                }
            })
        );

        return highlightsWithItems;
    } catch {
        return [];
    }
}
